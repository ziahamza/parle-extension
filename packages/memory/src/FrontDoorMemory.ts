/**
 * Remembering which addresses turned out to be a site's front door.
 *
 * The product owner's ask, in their words: *"once you find a page where it's an
 * everlasting page, we should put it in the block list… a Bloom filter, not of
 * the positive but the negative… At the same time, I don't want to miss a page
 * which has been discussed on Hacker News literally the moment it is
 * discussed."* Both halves are here, and they are in tension only if the
 * remembered judgement is allowed to answer questions it was never about.
 *
 * ## Why this may be remembered when ADR 0005 forbids remembering the positive
 *
 * ADR 0005 refuses to gate Lookups on a Discussion Index, because that index's
 * failure mode is a **silent false negative**: a Lookup that never fires, a
 * Discussion the reader never learns existed, and no signal that anything was
 * withheld. Nobody can complain about it, so nobody will.
 *
 * This store's failure mode is the mirror image, and it is **self-correcting
 * within one Lookup**. A wrong entry here renders the front-door treatment on a
 * page that is not a front door; the Lookup answers a moment later, the rule is
 * re-derived from the real Discussions, the verdict is overwritten and the panel
 * un-folds. It never causes a Lookup to be skipped, because the Linked Lookup —
 * the one that finds the Discussions the panel is for — does not consult it at
 * all. It therefore cannot produce a silent false negative of the kind that ADR
 * forbids, and that asymmetry is the entire justification for its existence.
 *
 * The corollary is a hard rule with a test on it: **`recall` may inform what is
 * drawn and which Topical Lookups are issued; it may never stop a Linked
 * Lookup.**
 *
 * ## Why the judgement cannot go stale in the dangerous direction
 *
 * Not a TTL, not a confidence score — a **domain restriction**. The remembered
 * verdict is only ever applied to Discussions older than
 * `FrontDoor.HORIZON_MS`. A Discussion posted inside the horizon is drawn
 * whatever this store says, because this store is not consulted for it. "I do
 * not want to miss a page discussed the moment it is discussed" is therefore not
 * a risk being mitigated; it is structurally outside what a judgement here can
 * reach.
 *
 * Two further guards, both of which cost nothing because re-deriving a verdict
 * needs no request:
 *
 *   - a `rulesVersion` stamp, so no stored judgement outlives the code that made
 *     it, and
 *   - a wall-clock ceiling, so a judgement made from a thin answer on a bad day
 *     expires on its own even if the reader never returns while a Lookup runs.
 *
 * ## Why this is exact and not a filter, for now
 *
 * A Bloom filter is the right structure for the SHIPPED artifact: because the
 * rule only ever fires on a rootish address, every key is a host, and the head
 * of the web is perhaps 100k of them — about 125 KB at a 1% false-positive rate.
 * That artifact belongs to `@parle/index-codec`, and it is the negative twin of
 * the Discussion Index that ADR 0005 keeps off the gate path.
 *
 * What the reader's own machine holds is a different set: the front doors *they*
 * have opened, which is tens to hundreds of entries. A filter over that set
 * would trade an exact answer for false positives and save nothing worth having,
 * and it could not carry `judgedThrough` — the one field that lets an old
 * judgement be invalidated by evidence rather than by a clock. So this is a
 * plain keyed store, and the filter is what arrives beside it.
 *
 * ## Keys are concealed, because this IS a record of what the reader read
 *
 * A front-door verdict is only ever written after an Enquiry on that address, so
 * a plaintext `parle/frontdoor/bankofamerica.com` on disk is a plaintext record
 * that this reader opened bankofamerica.com. `Recollection` may key in plaintext
 * because it is built from links the reader *saw* on pages already loaded; this
 * store is the opposite, and it is keyed the way `LookupRecord` is — through
 * `OpaqueKeys`, salted per install, never read back. Recognition is the whole
 * requirement here, exactly as it is there, so nothing is lost by concealing it.
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { SubjectUrl } from "@parle/domain/Subject"
import { readText, writeText } from "./Codec.ts"
import { OpaqueKeys } from "./OpaqueKeys.ts"
import { Storage, substitute, swallow } from "./Storage.ts"

/** Where these live in the reader's own store. */
export const PREFIX = "parle/frontdoor/"

/**
 * What was concluded about one address, and everything needed to distrust it.
 *
 * `judgedThrough` is the `postedAt` of the newest Discussion the judgement was
 * made from. It is what makes invalidation evidence-driven rather than
 * clock-driven: any answer carrying something newer is an answer this judgement
 * has not seen, so the verdict is recomputed rather than reused.
 */
export const Judgement = Schema.Struct({
  because: Schema.Literals(["titles-disagree", "incident"]),
  /** Which version of `FrontDoor`'s rules reached this. */
  rulesVersion: Schema.Number,
  /** `postedAt` of the newest Discussion this saw. 0 when none carried one. */
  judgedThrough: Schema.Number,
  /** When this machine wrote it. */
  judgedAt: Schema.Number
})
export type Judgement = typeof Judgement.Type

/**
 * How long a judgement is trusted without being re-derived, at the outside.
 *
 * Belt and braces rather than the mechanism. The real invalidation is
 * `judgedThrough` against the next answer, and re-derivation is free — this only
 * bounds the case where a reader opens a front door repeatedly while every
 * Lookup refuses, so nothing ever arrives to overwrite a judgement made from a
 * thin answer.
 */
export const TRUSTED_FOR_MS = 90 * 24 * 60 * 60 * 1000

/**
 * What one address is remembered AS, before the key is concealed.
 *
 * The host, and the path when there is one worth keeping. The rule only fires on
 * a rootish address, so in practice this is a host — but locale roots
 * (`example.com/en`) are real front doors with a path, and folding them onto the
 * host alone would judge a whole site from one of its language homepages.
 *
 * Exported because it is the interesting half: it is what makes the shipped form
 * of this a host list rather than a URL list, and therefore small.
 */
export const siteOf = (subject: SubjectUrl): string => {
  try {
    const url = new URL(subject as string)
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
    return `${url.hostname.toLowerCase()}${path}`
  } catch {
    return subject as string
  }
}

export class FrontDoorMemory extends Context.Service<FrontDoorMemory, {
  /**
   * What was concluded about this address last time, if anything still worth
   * believing.
   *
   * Never fails, and answers `none` for everything it is unsure about — a stale
   * rules version, an expired judgement, an unreadable store. Every one of those
   * means "derive it again", which costs nothing.
   */
  readonly recall: (subject: SubjectUrl) => Effect.Effect<Option.Option<Judgement>>
  /**
   * Write down that this address is a front door.
   *
   * Total, like every other write in this package: a store that will not take it
   * must not delay or fail what is on screen. The reader loses a fold on the
   * first frame of their next visit and nothing else.
   */
  readonly remember: (
    subject: SubjectUrl,
    said: { readonly because: "titles-disagree" | "incident"; readonly judgedThrough: number }
  ) => Effect.Effect<void>
  /**
   * Take an address back off the list.
   *
   * Called whenever the rule is re-derived and comes back `Document` — which is
   * what makes a wrong entry self-correcting rather than sticky. A page that
   * grows a real conversation stops being remembered as a front door on the next
   * answer, not on the next release.
   */
  readonly forget: (subject: SubjectUrl) => Effect.Effect<void>
  /** Everything remembered, for the settings page and for `Forget`. */
  readonly forgetAll: Effect.Effect<void>
}>()("parle/memory/FrontDoorMemory") {
  static readonly layer = (
    rulesVersion: number
  ): Layer.Layer<FrontDoorMemory, never, Storage | OpaqueKeys> =>
    Layer.effect(
      FrontDoorMemory,
      Effect.gen(function*() {
        const store = yield* Storage
        const keys = yield* OpaqueKeys
        const keyOf = (subject: SubjectUrl) =>
          Effect.map(keys.conceal(`frontdoor ${siteOf(subject)}`), (key) => `${PREFIX}${key as string}`)

        const recall = Effect.fn("FrontDoorMemory.recall")(function*(subject: SubjectUrl) {
          const key = yield* keyOf(subject)
          const held = yield* substitute(store.get(key), Option.none<string>(), "a front-door judgement")
          if (Option.isNone(held)) return Option.none<Judgement>()
          const decoded = yield* readText(Judgement, held.value, "a front-door judgement")
          if (Option.isNone(decoded)) return Option.none<Judgement>()
          const judgement = decoded.value
          // A judgement made by different rules is not a weaker judgement, it is
          // a judgement about a different question. Re-derivation is free, so
          // there is no reason to keep it.
          if (judgement.rulesVersion !== rulesVersion) return Option.none<Judgement>()
          const now = yield* Clock.currentTimeMillis
          if (now - judgement.judgedAt > TRUSTED_FOR_MS) return Option.none<Judgement>()
          return Option.some(judgement)
        })

        const remember = Effect.fn("FrontDoorMemory.remember")(function*(
          subject: SubjectUrl,
          said: { readonly because: "titles-disagree" | "incident"; readonly judgedThrough: number }
        ) {
          const now = yield* Clock.currentTimeMillis
          const encoded = yield* writeText(
            Judgement,
            {
              because: said.because,
              rulesVersion,
              judgedThrough: said.judgedThrough,
              judgedAt: now
            },
            "a front-door judgement"
          )
          // Nothing means "do not write". Replacing a good judgement with a bad
          // one is the failure that would stick; losing this one is a fold the
          // reader does not get on their next first frame.
          if (Option.isNone(encoded)) return
          yield* swallow(store.set(yield* keyOf(subject), encoded.value), "a front-door judgement")
        })

        const forget = Effect.fn("FrontDoorMemory.forget")(function*(subject: SubjectUrl) {
          yield* swallow(store.remove(yield* keyOf(subject)), "a front-door judgement")
        })

        const forgetAll = Effect.gen(function*() {
          const keys = yield* substitute(store.keys(PREFIX), [] as ReadonlyArray<string>, "front-door judgements")
          for (const key of keys) yield* swallow(store.remove(key), "a front-door judgement")
        })

        return FrontDoorMemory.of({ recall, remember, forget, forgetAll })
      })
    )
}
