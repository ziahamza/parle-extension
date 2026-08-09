/**
 * Writing a Digest, and holding it to account.
 *
 * Three things happen here and the order of them is the design.
 *
 * **`brief` selects.** What reaches the model is chosen by {@link ./Selection.ts},
 * which is written to preserve disagreement rather than rank by score. See that
 * file for why top-by-score is the wrong default twice over.
 *
 * **`write` streams Findings, and does not return a Digest.** This is
 * load-bearing. The citation invariant lives on the Finding, so a Provider that
 * dies after producing two good Findings and half of a third yields two good
 * Findings — where an `Effect<Digest>` would have to fail, throwing away tokens
 * the reader already paid for out of their own subscription. Everything that can
 * go wrong short of "no answer at all" therefore degrades to `partial` rather
 * than to a failure: a truncated object, an object that will not parse, a
 * Finding citing a Discussion the Brief never held, a Finding citing a comment
 * that does not exist, a contested Finding that cites no comment at all.
 *
 * **A Provider dying after it had begun to speak is NOT in that list, and this
 * module cannot put it there.** Every shipped layer in `@parle/provider` applies
 * `keepWhatArrived` inside `chat`, which converts a mid-stream
 * `ProviderUnavailable` into a normal end of stream before it ever reaches here.
 * By the time this file sees the answer, "the model finished" and "the model was
 * cut off at a line boundary" are the same event. The guard below therefore
 * fires only for a Provider layer that does not apply `keepWhatArrived`, and the
 * only mid-answer death this module can detect on its own is one that lands
 * inside an object, where the scanner reports {@link Scanned} `Truncated`. A
 * death falling exactly on an object boundary is recorded as `complete`, and
 * that is wrong: fixing it needs the Provider seam to say that it swallowed a
 * failure, which is a change to `@parle/provider`, not to this file.
 *
 * **`admit` is the only door in.** `@parle/domain` makes the Brief a DECODING
 * SERVICE, so `Effect<Digest, SchemaError, Brief>` cannot be run without
 * producing the material the Digest was supposed to have been written from. That
 * is not a convention this module could forget: there is no other constructor.
 * Model output is never `.make`d here, `{ disableChecks: true }` appears
 * nowhere, and the whole assembled document goes back through `admit` a second
 * time — the same door the Shared Digest bytes come through — so a bug in this
 * file cannot produce a Digest that the invariant would have rejected.
 *
 * What is deliberately NOT here: any notion of a diff. ADR 0007 was amended on
 * 2026-08-08 to delete the reader-facing Delta, the Last Look horizon, and
 * `Digests.since` outright. A Digest is the current summary of the whole of a
 * Subject's Discussions. The Watermark survives only as the internal signal
 * behind {@link isStale}.
 */
import {
  admit,
  Brief as BriefService,
  type Completeness,
  type Digest,
  Finding
} from "@parle/domain/Digest"
import type { LinkedMention } from "@parle/domain/Mention"
import { type DiscussionId, discussionKey } from "@parle/domain/Network"
import type { SubjectUrl } from "@parle/domain/Subject"
import { Provider, stampOf, UnavailableReason } from "@parle/provider/Provider"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
  type Brief,
  citesAComment,
  commentsTaken,
  pointersOf,
  resolves,
  type Selected
} from "./Brief.ts"
import { Comments } from "./Comments.ts"
import { turnsFor } from "./Prompt.ts"
import { emptyScan, onHalt, parse, scan, type Scanned } from "./Scan.ts"
import { defaultLimits, type Limits, selectComments, selectDiscussions } from "./Selection.ts"
import { isStale, type Numbers, type Watermark, watermarkOf } from "./Watermark.ts"

/**
 * Why no Digest could be written at all.
 *
 * Only three, and every one of them is a state before any Finding existed. Once
 * a single Finding has been admitted the answer is a `partial` Digest, never a
 * failure — that is the whole point of streaming them.
 *
 * The Network vocabulary (Refusal, Garble, Withholding) is not reused, for the
 * same reason `ProviderUnavailable` does not reuse it: those are facts about a
 * Network's answer about a Subject and they land in Coverage. This is a fact
 * about writing, and it lands in the panel's Digest slot.
 */
export const DigestRefusedReason = Schema.Literals([
  /** The Brief holds no Discussion we could read. Nothing was asked of anyone. */
  "nothing-to-summarise",
  /** The Provider never spoke. Its own reason travels alongside. */
  "provider-unavailable",
  /** The Provider spoke and not one Finding survived the Brief. */
  "nothing-citeable"
])
export type DigestRefusedReason = typeof DigestRefusedReason.Type

export class DigestRefused extends Schema.TaggedError<DigestRefused>()("DigestRefused", {
  reason: DigestRefusedReason,
  /** For the log and for a support thread. Never rendered as blame. */
  detail: Schema.String,
  /**
   * The Provider's own reason, when there was one.
   *
   * Carried rather than collapsed because "you have connected nothing" and
   * "your key has no quota" want different copy and different offers, and ADR
   * 0004 requires the product to keep working through both.
   */
  providerReason: Schema.optionalKey(UnavailableReason)
}) {}

/** Decoding one Finding. Requires the Brief; there is no variant that does not. */
const admitFinding: (raw: unknown) => Effect.Effect<Finding, Schema.SchemaError, BriefService> =
  Schema.decodeUnknownEffect(Finding)

/**
 * Build the Brief for a Subject from its Linked Mentions.
 *
 * Linked only, by signature. A Topical Mention proves the subject matter was
 * discussed somewhere, never that the conversation is about this page, and
 * summarising one into a Digest of this Subject would attribute a stranger's
 * argument to the reader's page. The evidence tier is the whole difference and
 * the compiler holds it.
 */
export const brief = Effect.fn("Digests.brief")(function*(
  subject: SubjectUrl,
  linked: ReadonlyArray<LinkedMention>,
  limits: Limits = defaultLimits
) {
  const comments = yield* Comments

  const seen = new Set<string>()
  const distinct: Array<DiscussionId> = []
  for (const mention of linked) {
    const key = discussionKey(mention.discussion)
    if (seen.has(key)) continue
    seen.add(key)
    distinct.push(mention.discussion)
  }

  const wanted = selectDiscussions(distinct, (id) => id.network, limits.discussions)

  const selected: Array<Selected> = []
  for (const discussion of wanted) {
    const contents = yield* comments.of(discussion)
    if (Option.isNone(contents)) continue
    const taken = selectComments(contents.value.comments, limits)
    // A Discussion we could reach but which said nothing is not material. It
    // would render in the prompt as a title with no conversation under it, and
    // a model given that will summarise the title.
    if (taken.length === 0) continue
    selected.push({
      discussion,
      title: contents.value.title,
      score: contents.value.score,
      commentCount: contents.value.commentCount,
      comments: taken
    })
  }

  // Biggest conversation first, so the Brief leads with what most people read.
  // Membership was already decided round-robin across Networks, so ordering here
  // cannot cost the smaller Network its place.
  const ordered = [...selected].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))

  return {
    subject,
    selected: ordered,
    watermark: watermarkOf(
      ordered.map((s): Numbers => ({
        discussion: s.discussion,
        score: s.score,
        comments: s.commentCount
      }))
    )
  } satisfies Brief
})

/**
 * Everything that makes a Digest `partial` rather than complete.
 *
 * One flag rather than a count, because nothing downstream may branch on how
 * many Findings were lost — `Completeness` has two constructors and the reader
 * is told which, not how badly.
 */
const marredBy = (faults: Ref.Ref<boolean>) => Ref.set(faults, true)

/**
 * The candidate Findings inside one scanned object.
 *
 * Almost always the object itself. The exception is the single most common
 * formatting mistake a model told "one JSON object per line" makes: answering
 * `{"findings": [ … ]}` instead. The scanner cannot see through that — it emits
 * whole top-level objects, and emitting nested ones as well would turn every
 * `citations` array into a stream of junk candidates — so the wrapper is opened
 * here, where a candidate is already known to be a Finding or not.
 *
 * Narrow on purpose: exactly one own property, and its value an array. A real
 * Finding has three properties, so it can never be mistaken for a wrapper, and
 * no key name is guessed at. This is a formatting mistake rather than a citation
 * mistake and it must not cost the reader every Finding they paid for — which is
 * what it did, right down to a `nothing-citeable` refusal blaming their model.
 */
const candidatesOf = (value: unknown): ReadonlyArray<unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [value]
  const held = Object.values(value as Record<string, unknown>)
  const only = held[0]
  if (held.length !== 1 || !Array.isArray(only) || only.length === 0) return [value]
  return only as ReadonlyArray<unknown>
}

/**
 * Whether a statement puts nothing at all on the reader's screen.
 *
 * `String.prototype.trim` removes Unicode `White_Space` and NOTHING ELSE, and
 * the characters that matter here are deliberately not in that set:
 * `U+200B ZERO WIDTH SPACE`, `U+200C`/`U+200D` (the joiners), `U+2060 WORD
 * JOINER`, `U+FEFF` and `U+00AD SOFT HYPHEN` are all general category `Cf`.
 * So `"​"` passed the blank test, decoded, held up, and rendered as an
 * empty paragraph with a real citation hanging off it — which is exactly the
 * output the blank test exists to stop, produced by a model that wrote one
 * character instead of none.
 *
 * It is the same shape as the two fabrications this package has already been
 * bitten by: the invariant is satisfied by producing LESS rather than more. A
 * `contested` one is the bad case — the panel prints "Someone in these
 * discussions disagreed with this" above a line that says nothing, which is the
 * strongest claim the product makes attached to no claim at all.
 *
 * `Cc` is in the class as well because a statement of control characters is the
 * same absence wearing a different coat.
 */
const saysNothing = (statement: string): boolean =>
  statement.replace(/[\p{White_Space}\p{Cf}\p{Cc}]/gu, "") === ""

/**
 * The checks a Finding must pass here, over and above `admit`.
 *
 * Both are STRENGTHENINGS: they only ever reject more, and neither is a
 * substitute for the decode that already proved every Citation names a
 * Discussion in the Brief.
 *
 *   - Every Citation must resolve to material actually in the Brief. `admit`
 *     cannot check the comment inside the Discussion, because the decoding Brief
 *     cannot see comments; that pointer is checked here, where the material is.
 *   - A `contested` Finding must cite at least one IDENTIFIED COMMENT. ADR 0006
 *     permits the flag only when a Discussion evidences it and requires the
 *     reader to be able to go and judge the objection themselves — and a
 *     contested flag whose only Citation is a 233-comment thread is not
 *     checkable by anyone. It was also the way through: the comment pointer is
 *     the only part of a Citation a fabricating model has to get right, and
 *     omitting the field skipped the check entirely, so the highest-trust claim
 *     in the product was the one carrying the least evidence. A Finding that
 *     merely reports is unaffected; summarising a thread as a whole is exactly
 *     what a whole-Discussion Citation is for.
 *
 * A blank statement is rejected for the ordinary reason: it decodes as a
 * structurally perfect, fully cited Finding that asserts nothing, and renders as
 * an empty line with a source hanging off it. See {@link saysNothing} for why
 * `trim()` is not the test.
 */
const holdsUp = (finding: Finding, pointers: ReadonlySet<string>): boolean => {
  if (saysNothing(finding.statement)) return false
  if (!finding.citations.every((citation) => resolves(pointers, citation))) return false
  return !finding.contested || finding.citations.some(citesAComment)
}

/**
 * The Findings a Provider produces from a Brief, in arrival order.
 *
 * `faults` is threaded rather than returned because `write` promises a
 * `Stream<Finding>` and nothing else; {@link digest} owns the Ref and therefore
 * learns the completeness, while a panel subscribing to `write` renders Findings
 * as they land and never has to know.
 */
const findingsFrom = (
  material: Brief,
  faults: Ref.Ref<boolean>
): Stream.Stream<Finding, DigestRefused, Provider | BriefService> =>
  Stream.unwrap(Effect.gen(function*() {
    // Counted rather than merely non-empty. `Brief` is a plain interface with no
    // codec — deliberately, so it can never become a durable record of what the
    // reader read — so nothing but this stops a caller assembling one from
    // Discussions whose comments are all missing. `brief` already drops those
    // one at a time; a Brief that arrived from anywhere else would otherwise
    // reach the Provider as titles with no conversation under them, and a model
    // given that will summarise the title. That is the one output ADR 0006 calls
    // a bug, and it would be perfectly cited.
    if (commentsTaken(material) === 0) {
      return Stream.fail(
        new DigestRefused({
          reason: "nothing-to-summarise",
          detail: "the Brief holds no Discussion whose comments could be read"
        })
      )
    }

    const provider = yield* Provider
    const pointers = pointersOf(material)
    const spoke = yield* Ref.make(false)

    const nothing: Stream.Stream<Finding, DigestRefused, BriefService> = Stream.empty

    /**
     * A Provider that has already spoken cannot become unavailable.
     *
     * This is `keepWhatArrived`'s rule written out again, and it is important to
     * be honest about what that buys and what it does not. Every SHIPPED layer
     * in `@parle/provider` already applies `keepWhatArrived` inside `chat`, so
     * for those this branch is unreachable: the failure was swallowed one layer
     * down and the answer arrives here as a clean end of stream. What this
     * covers is a Provider layer that does NOT apply it — a test double, a
     * future implementation, an out-of-tree one — for which a mid-answer failure
     * would otherwise collapse the Findings already produced.
     *
     * It does NOT recover the information `keepWhatArrived` destroyed. Writing
     * the rule out downstream of the thing that erased the signal cannot
     * reconstruct it; see the note at the top of this file.
     *
     * `catchTag` rather than `catchCause`: interruption and defects must still
     * propagate, or a Reading the reader navigated away from would look like a
     * complete answer.
     */
    const spoken: Stream.Stream<string, DigestRefused> = provider.chat(
      turnsFor(material)
    ).pipe(
      Stream.tap(() => Ref.set(spoke, true)),
      Stream.catchTag("ProviderUnavailable", (unavailable) =>
        Stream.unwrap(Effect.gen(function*() {
          const hasSpoken = yield* Ref.get(spoke)
          if (!hasSpoken) {
            return Stream.fail(
              new DigestRefused({
                reason: "provider-unavailable",
                detail: unavailable.detail,
                providerReason: unavailable.reason
              })
            )
          }
          yield* marredBy(faults)
          const ended: Stream.Stream<string, DigestRefused> = Stream.empty
          return ended
        })))
    )

    /** One candidate object, admitted or dropped. Dropping is always a fault. */
    const admitted = (
      candidate: unknown
    ): Stream.Stream<Finding, DigestRefused, BriefService> =>
      Stream.unwrap(
        admitFinding(candidate).pipe(
          Effect.flatMap((finding) =>
            holdsUp(finding, pointers)
              ? Effect.succeed<Stream.Stream<Finding, DigestRefused, BriefService>>(
                Stream.succeed(finding)
              )
              : Effect.as(marredBy(faults), nothing)
          ),
          Effect.catch(() => Effect.as(marredBy(faults), nothing))
        )
      )

    /**
     * The end of an answer that never began.
     *
     * A Provider that completes without emitting a single Chunk has not said
     * anything unciteable — it has not said anything. Reporting that as
     * `nothing-citeable` tells the reader their own model wrote uncitable
     * output, which is blame in the wrong place and the wrong offer to make
     * them. It is a state before any Finding existed, so it refuses.
     */
    const silence: Stream.Stream<Finding, DigestRefused, BriefService> = Stream.unwrap(
      Effect.map(Ref.get(spoke), (hasSpoken) =>
        hasSpoken ? nothing : Stream.fail(
          new DigestRefused({
            reason: "provider-unavailable",
            detail: "the Provider completed without producing any answer at all",
            providerReason: "could-not-answer"
          })
        ))
    )

    return spoken.pipe(
      Stream.mapAccum(() => emptyScan, scan, { onHalt }),
      Stream.flatMap((scanned: Scanned): Stream.Stream<Finding, DigestRefused, BriefService> => {
        if (scanned._tag === "Truncated") {
          return Stream.unwrap(Effect.as(marredBy(faults), nothing))
        }
        const parsed = parse(scanned.text)
        if (!parsed.ok) return Stream.unwrap(Effect.as(marredBy(faults), nothing))
        return Stream.flatMap(Stream.fromIterable(candidatesOf(parsed.value)), admitted)
      }),
      Stream.concat(silence)
    )
  }))

/**
 * Write the whole Digest.
 *
 * The origin is stamped from the connected Provider rather than passed in: a
 * Digest written through this seam ran on the reader's machine against their own
 * Provider and never left it, so it is Local by construction and there is no way
 * for a caller to claim otherwise.
 *
 * The assembled document goes back through `admit`. That is not paranoia about
 * this module: it is the same door the Shared Digest's bytes come through, and
 * running it in one place means a Digest cannot be built here that the invariant
 * would reject there. It is also what turns "every Finding was rejected" into
 * `nothing-citeable` for free, since a Digest with no Findings does not decode.
 */
export const digest = Effect.fn("Digests.digest")(function*(material: Brief) {
  const provider = yield* Provider
  const faults = yield* Ref.make(false)
  const findings = yield* Stream.runCollect(findingsFrom(material, faults))
  const marred = yield* Ref.get(faults)
  const completeness: Completeness = marred ? "partial" : "complete"

  return yield* admit({
    subject: material.subject,
    origin: stampOf(provider),
    completeness,
    findings
  }).pipe(
    Effect.mapError((error) =>
      new DigestRefused({
        reason: "nothing-citeable",
        detail: findings.length === 0
          ? "the Provider answered and not one Finding could be cited to the Brief"
          : `the assembled Digest did not decode: ${error}`
      })
    )
  )
})

/**
 * The Findings a Provider produces from a Brief, in arrival order.
 *
 * This is what a panel subscribes to, and it deliberately says nothing about
 * completeness. A Finding is renderable the moment it arrives — the invariant is
 * already discharged on it — whereas `complete` and `partial` are only knowable
 * once the Provider has stopped, which is exactly the wait ADR 0008's streaming
 * panel exists to avoid. The faults recorded here are therefore dropped on the
 * floor; {@link digest} runs the same pipeline while holding the Ref, and it is
 * the one that produces a Digest marked one way or the other.
 */
export const write = (
  material: Brief
): Stream.Stream<Finding, DigestRefused, Provider | BriefService> =>
  Stream.unwrap(Effect.map(Ref.make(false), (faults) => findingsFrom(material, faults)))

/**
 * The only construction site for a Digest.
 *
 * `admit` is re-exported rather than reimplemented — it is `@parle/domain`'s,
 * and having exactly one is the point.
 */
export class Digests extends Context.Service<Digests, {
  readonly brief: (
    subject: SubjectUrl,
    linked: ReadonlyArray<LinkedMention>
  ) => Effect.Effect<Brief, never, Comments>
  readonly write: (
    material: Brief
  ) => Stream.Stream<Finding, DigestRefused, Provider | BriefService>
  readonly digest: (
    material: Brief
  ) => Effect.Effect<Digest, DigestRefused, Provider | BriefService>
  readonly isStale: (watermark: Watermark, current: ReadonlyArray<Numbers>) => boolean
  readonly admit: (raw: unknown) => Effect.Effect<Digest, Schema.SchemaError, BriefService>
}>()("parle/digest/Digests") {
  static readonly layer: Layer.Layer<Digests> = Layer.succeed(
    Digests,
    Digests.of({
      brief: (subject, linked) => brief(subject, linked),
      write,
      digest,
      isStale,
      admit
    })
  )
}
