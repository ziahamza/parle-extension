/**
 * The Local Discussion Cache — the reader's own store of Mentions and
 * Observations.
 *
 * It stores **Mentions**, not rows. A cache hit therefore arrives already
 * carrying its tier and the evidence for it, and the panel interprets nothing:
 * there is no place where a stored record is looked at and a tier is *decided*,
 * which is where the tier would drift from the evidence. It is also what lets
 * `mayAskX` read a recalled Mention exactly as it reads a fetched one.
 *
 * `remember` refuses a Mention with no Subject URL. That is ADR 0012's "key on
 * the resolved destination, never the tracking URL" made unrepresentable rather
 * than merely remembered: `Mention.subject` is a branded `SubjectUrl` that only
 * the canonicalizer mints, so the compiler stops it, and this runtime check stops
 * whatever arrives by another route — a decoded blob from an older build, a
 * harvest whose `t.co` never resolved. A Mention with no destination is not a
 * weak Mention, it is a Mention of the wrong page.
 *
 * **The key is a claim the world can revise.** A Mention keys on an alias set
 * that grows, so learning tomorrow that two addresses are one page must repair
 * the rows stored today — {@link Recollection.merge}. ADR 0015 takes this cost
 * knowingly: the alternative, an immutable key, silently orphans everything
 * stored under a superseded address, and that is a permanent and *undetectable*
 * false-negative class landing on exactly the pages worth reading. A 640-point
 * thread that becomes unfindable because the publisher changed a slug is the
 * failure this project keeps choosing against.
 *
 * **Totality is load-bearing.** MV3 kills the service worker without running
 * finalizers, so there is no "flush on shutdown" to be had: writes commit eagerly,
 * per event, and are already durable when the worker dies. The corollary is that
 * a storage failure must not widen the error channel — `remember`, `observe` and
 * `merge` are all `Effect<void, never>`. A reader whose disk is full still gets
 * Hacker News in the panel; they simply do not get it for free next time.
 *
 * Keys here are plaintext, deliberately, and the contrast with `LookupRecord` is
 * the whole privacy argument. This store is built by Harvest from Network pages
 * the reader had already loaded — its addresses are links they *saw*, not pages
 * they *visited* — so it discloses nothing extra and there is nothing to conceal.
 * The Lookup Record is the opposite, and is keyed accordingly.
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, discussionKey } from "@parle/domain/Network"
import { AliasEvidence, SubjectUrl } from "@parle/domain/Subject"
import { readText, writeText } from "./Codec.ts"
import { Observation } from "./Observation.ts"
import { originOf, originScope } from "./OpaqueKeys.ts"
import { attempted, Storage, substitute, swallow } from "./Storage.ts"

/**
 * How much of the reader's Recollection to clear.
 *
 * A plain union rather than a `Schema.TaggedUnion`: this is an argument, never a
 * stored or transmitted shape, and a caller should be able to write
 * `{ _tag: "Origin", origin }` without reaching for a constructor.
 *
 * ADR 0012 promised clearing is "a visible, single action"; ADR 0015 amends that
 * to one prominent clear across both stores plus a finer Lookup-Record-only
 * control — see `Forget`, which is where a caller should reach for either. The
 * scopes here are the mechanism, not the reader-facing controls. `Origin` earns
 * its place because the Exclusion List grows: when a rule is shipped tomorrow for
 * a category we harvested yesterday, `Origin` is what retires the rows that rule
 * would have prevented.
 */
export type Forgetting =
  | { readonly _tag: "All" }
  | { readonly _tag: "Origin"; readonly origin: string }
  | { readonly _tag: "Subject"; readonly subject: SubjectUrl }

/** A Mention as stored, stamped with when this machine recorded it. */
const Kept = Schema.Struct({
  mention: Mention,
  rememberedAt: Schema.Number
})
const KeptMentions = Schema.Array(Kept)

/**
 * A superseded address and the address that now represents its Subject.
 *
 * Kept rather than deleted, because the reader can still arrive by the old
 * address — from a bookmark, an old Discussion, a syndicated copy — and a merge
 * that made that arrival stop finding anything would have introduced exactly the
 * orphaning it exists to repair. The evidence rides along so a future audit can
 * ask *why* two addresses were joined without the answer being "someone said so".
 */
const Forwarded = Schema.Struct({
  into: Schema.String,
  evidence: AliasEvidence,
  mergedAt: Schema.Number
})

/** How the reader's own machine answers "what already knows about this page?" */
export class Recollection extends Context.Service<Recollection, {
  /**
   * Every Mention this machine holds for a Subject, tier and evidence intact.
   *
   * Follows any merge, so an address superseded a week ago still answers. A
   * Stream rather than an Effect so the Enquiry can merge it with the network
   * waves instead of concatenating them — a slow iOS storage read must not be
   * able to hold up Hacker News.
   */
  readonly recall: (subject: SubjectUrl) => Stream.Stream<Mention>
  /** Commit Mentions now. Total: refusals and storage failures are logged, never raised. */
  readonly remember: (mentions: ReadonlyArray<Mention>) => Effect.Effect<void>
  /** Commit Observations now. An older reading never displaces a newer one. */
  readonly observe: (observations: ReadonlyArray<Observation>) => Effect.Effect<void>
  /** The most recent numbers held for one Discussion. */
  readonly latest: (discussion: DiscussionId) => Effect.Effect<Option.Option<Observation>>
  /**
   * Two addresses are one page: re-key `from`'s stored Mentions onto `into`.
   *
   * Takes `AliasEvidence` and not a boolean, a string, or a reason code, because
   * `AliasEvidence` is the domain type that structurally cannot be a page's own
   * `rel=canonical`. A caller holding a self-declaration has nothing to pass —
   * see `Merge.observed`, which is where that refusal is written down.
   *
   * Safe to run while reads are in flight; the ordering that makes it so is
   * described at the implementation.
   */
  readonly merge: (
    into: SubjectUrl,
    from: SubjectUrl,
    evidence: AliasEvidence
  ) => Effect.Effect<void>
  /** The currently elected address for a Subject, after any merges. */
  readonly elect: (subject: SubjectUrl) => Effect.Effect<SubjectUrl>
  readonly forget: (scope: Forgetting) => Effect.Effect<void>
}>()("parle/memory/Recollection") {
  static readonly layer: Layer.Layer<Recollection, never, Storage> = Layer.effect(Recollection)(
    Effect.gen(function*() {
      const storage = yield* Storage

      /**
       * The Mentions stored under a key, or nothing — and the difference is
       * load-bearing.
       *
       * `Option.none` is **not** "the row is empty". It is "this machine cannot
       * tell you what is in that row": the read was refused, or the blob decoded
       * to nothing because an older build wrote it or a killed worker truncated
       * it. `Option.some([])` is the definite answer that there is nothing there.
       *
       * Reads may flatten the two together — see {@link loadMentions} — because
       * an unreadable row and an absent one look identical to a panel. `merge`
       * may not, because it goes on to *delete* the row it read, and deleting a
       * row you could not read is the one operation where the difference is the
       * whole of the safety argument.
       */
      const readMentions = (key: string): Effect.Effect<Option.Option<ReadonlyArray<typeof Kept.Type>>> =>
        storage.get(key).pipe(
          Effect.flatMap((raw) =>
            Option.isNone(raw)
              ? Effect.succeed(Option.some<ReadonlyArray<typeof Kept.Type>>([]))
              : readText(KeptMentions, raw.value, "Recollection")
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Recollection could not be read", cause).pipe(
              Effect.as(Option.none<ReadonlyArray<typeof Kept.Type>>())
            )
          )
        )

      /** What a reader wants: an unreadable row and an absent one are both empty. */
      const loadMentions = (key: string): Effect.Effect<ReadonlyArray<typeof Kept.Type>> =>
        readMentions(key).pipe(
          Effect.map((held) => Option.isSome(held) ? held.value : [])
        )

      /**
       * Walk the forwarding pointers to whichever address currently represents
       * this Subject.
       *
       * Cycle-guarded rather than trusting the writer: a merge cycle would be a
       * bug, but it would be a bug that hangs the reader's panel, and the store
       * is a place where an older build's rows can outlive the code that wrote
       * them. The `seen` set is what makes the walk finite; `aliasHops` is a
       * latency backstop above any chain a real install grows, and is set where
       * it is because stopping short of the end of a chain answers with an
       * address whose row a merge already emptied. See the note there.
       */
      const elect = Effect.fn("Recollection.elect")(function*(subject: SubjectUrl) {
        let current = subject
        const seen = new Set<string>([current])
        for (let hop = 0; hop < aliasHops; hop++) {
          const raw = yield* substitute(storage.get(aliasKey(current)), Option.none<string>(), "Recollection")
          if (Option.isNone(raw)) return current
          const held = yield* readText(Forwarded, raw.value, "Recollection")
          if (Option.isNone(held)) return current
          const next = SubjectUrl.make(held.value.into)
          if (next.length === 0 || seen.has(next)) return current
          seen.add(next)
          current = next
        }
        return current
      })

      const recall = (subject: SubjectUrl): Stream.Stream<Mention> =>
        Stream.unwrap(
          elect(subject).pipe(
            Effect.flatMap((elected) => loadMentions(mentionsKey(elected))),
            Effect.map((kept) => Stream.fromIterable(kept.map((k) => k.mention)))
          )
        )

      const remember = Effect.fn("Recollection.remember")(function*(mentions: ReadonlyArray<Mention>) {
        const usable = mentions.filter(hasSubject)
        const refused = mentions.length - usable.length
        if (refused > 0) {
          // Not an error: harvest offers what it found, and what it found may be
          // a link whose destination never resolved. The reader loses nothing
          // they could have had.
          yield* Effect.logWarning(
            `Recollection refused ${refused} Mention(s) carrying no Subject URL`
          )
        }
        if (usable.length === 0) return

        const now = yield* Clock.currentTimeMillis
        const bySubject = new Map<SubjectUrl, Array<Mention>>()
        for (const mention of usable) {
          // Elected *before* grouping, so a Mention arriving under a superseded
          // address lands in the merged row rather than founding a fresh orphan
          // beside it. Without this, `merge` would repair the past and the next
          // harvest would break it again.
          const elected = yield* elect(mention.subject)
          const arriving = rekey(mention, elected)
          const existing = bySubject.get(elected)
          if (existing === undefined) bySubject.set(elected, [arriving])
          else existing.push(arriving)
        }

        for (const [subject, arriving] of bySubject) {
          const key = mentionsKey(subject)
          const held = yield* loadMentions(key)
          const merged = reconcile(held, arriving.map((mention) => ({ mention, rememberedAt: now })))
          const text = yield* writeText(KeptMentions, merged, "Recollection")
          if (Option.isSome(text)) yield* swallow(storage.set(key, text.value), "Recollection")
        }
      })

      const observe = Effect.fn("Recollection.observe")(function*(observations: ReadonlyArray<Observation>) {
        for (const arriving of observations) {
          const key = observationKey(arriving.discussion)
          const raw = yield* substitute(storage.get(key), Option.none<string>(), "Recollection")
          if (Option.isSome(raw)) {
            const held = yield* readText(Observation, raw.value, "Recollection")
            // Observations are never corrected, only superseded. A batch that
            // arrives late — a retried write, a queue drained after the worker
            // came back — must not walk the numbers backwards.
            if (Option.isSome(held) && held.value.receivedAt >= arriving.receivedAt) continue
          }
          const text = yield* writeText(Observation, arriving, "Recollection")
          if (Option.isSome(text)) yield* swallow(storage.set(key, text.value), "Recollection")
        }
      })

      const latest = Effect.fn("Recollection.latest")(function*(discussion: DiscussionId) {
        const raw = yield* substitute(storage.get(observationKey(discussion)), Option.none<string>(), "Recollection")
        if (Option.isNone(raw)) return Option.none<Observation>()
        return yield* readText(Observation, raw.value, "Recollection")
      })

      /**
       * The four writes below are in the only order that is safe without a
       * transaction, and the store has no transactions.
       *
       *   1. copy `from`'s Mentions into `into`, re-keyed;
       *   2. write the forwarding pointer `from → into`;
       *   3. drop `from`'s own row.
       *
       * A reader racing this sees, at every instant, one of: `from`'s original
       * row (before 2), or `into`'s row already containing it (after 2). There
       * is no window in which either address answers with less than it did
       * before — the only transient state is *duplication*, which `reconcile`
       * collapses on the next read. Doing it in the obvious order instead —
       * delete then copy — opens a window where a Reading that landed on the old
       * address gets an empty panel, which is precisely the orphaning this
       * exists to prevent, merely shortened to a few milliseconds.
       *
       * A crash between any two steps leaves the same duplication and no loss.
       *
       * **Ordering is only half the argument, and the weaker half.** Every step
       * below can also *fail* — a denied read, a row an older build wrote,
       * a quota-exceeded write on the platform this package is sized for — and
       * every one of those failures is swallowed into a logged nothing by design.
       * So the final `remove` is reached with exactly the same control flow
       * whether the copy happened or not, and a swallowed failure at step 1 turns
       * step 3 from "drop the duplicate" into "delete the only copy". Correct
       * ordering does not help: the steps run in the right order and the Mentions
       * are gone anyway.
       *
       * Hence every step is *gated* on the previous one having landed, and the
       * bail-out at each gate leaves the store in a state a later merge repairs:
       * before the pointer, a merge that has not happened yet; after it,
       * duplication that `reconcile` collapses. Neither is loss.
       */
      const merge = Effect.fn("Recollection.merge")(function*(
        into: SubjectUrl,
        from: SubjectUrl,
        evidence: AliasEvidence
      ) {
        if (!isAddress(into) || !isAddress(from)) {
          yield* Effect.logWarning("Recollection refused a merge with a blank address")
          return
        }
        const target = yield* elect(into)
        const source = yield* elect(from)
        // Already one Subject — including the case where the caller has the
        // direction backwards on a merge that already happened.
        if (source === target) return

        const now = yield* Clock.currentTimeMillis
        const moving = yield* readMentions(mentionsKey(source))
        if (Option.isNone(moving)) {
          // We are about to delete this row. Not being able to read it is
          // precisely the case where deleting it destroys evidence — so the
          // merge does not begin.
          yield* Effect.logWarning("Recollection could not read the row a merge would move; leaving both standing")
          return
        }

        if (moving.value.length > 0) {
          const held = yield* readMentions(mentionsKey(target))
          if (Option.isNone(held)) {
            // Writing the copy on top of a row we could not read would replace
            // the target's own Mentions with only the source's.
            yield* Effect.logWarning("Recollection could not read a merge's target row; leaving both standing")
            return
          }
          const merged = reconcile(
            held.value,
            moving.value.map((k) => ({ mention: rekey(k.mention, target), rememberedAt: k.rememberedAt }))
          )
          const text = yield* writeText(KeptMentions, merged, "Recollection")
          if (Option.isNone(text)) {
            yield* Effect.logWarning("Recollection could not encode a merge's target row; leaving both standing")
            return
          }
          const copied = yield* attempted(storage.set(mentionsKey(target), text.value), "Recollection")
          if (!copied) {
            // A full disk is the likeliest failure in this package, and it lands
            // exactly here. Publishing the pointer now would forward the old
            // address at a row that does not contain what was forwarded.
            yield* Effect.logWarning("Recollection could not copy a merge's Mentions; leaving both standing")
            return
          }
        }

        const pointer = yield* writeText(Forwarded, { into: target, evidence, mergedAt: now }, "Recollection")
        if (Option.isNone(pointer)) {
          // The pointer is what makes the merge visible to readers. Without it,
          // stopping here leaves both rows intact and the old address still
          // answering — a merge that did not happen, which is recoverable.
          // Dropping `source`'s row anyway would not be.
          yield* Effect.logWarning("Recollection could not record a merge; leaving both addresses standing")
          return
        }
        const published = yield* attempted(storage.set(aliasKey(source), pointer.value), "Recollection")
        if (!published) {
          // Same reasoning, one step later and one degree worse: with no pointer
          // written, dropping the source row leaves the old address resolving to
          // itself and holding nothing. That is the orphaning this whole
          // mechanism exists to prevent, arrived at by the mechanism itself.
          yield* Effect.logWarning("Recollection could not publish a merge's pointer; leaving both addresses standing")
          return
        }
        yield* swallow(storage.remove(mentionsKey(source)), "Recollection")

        // Point the address the caller actually held straight at the terminus,
        // skipping the hops it walked to get here. Purely a shortening — same
        // destination, same evidence — and it keeps the addresses a reader
        // arrives by from lengthening the chain every merge.
        if (from !== source) {
          yield* swallow(storage.set(aliasKey(from), pointer.value), "Recollection")
        }
      })

      const forget = Effect.fn("Recollection.forget")(function*(scope: Forgetting) {
        if (scope._tag === "Subject") {
          // Clears the row this address currently resolves to, not merely the
          // one it was first written under. "Forget this page" that leaves the
          // page's Mentions sitting under an address it was merged into would be
          // a promise broken silently.
          const elected = yield* elect(scope.subject)
          yield* swallow(storage.remove(mentionsKey(elected)), "Recollection")
          yield* swallow(storage.remove(aliasKey(scope.subject)), "Recollection")
          return
        }
        // `Origin` deliberately leaves Observations alone: they are numbers about
        // conversations on a Network, not a record of anything the reader did on
        // the origin being cleared. `All` takes everything, because that is the
        // prominent clear ADR 0015 keeps.
        // Through `originScope`, not as given: the keys were built from
        // `originOf`, and a scope that does not match them clears nothing while
        // still reporting success.
        const prefixes = scope._tag === "All"
          ? [root]
          : [
            `${mentionsRoot}${encodeURIComponent(originScope(scope.origin))}/`,
            `${aliasRoot}${encodeURIComponent(originScope(scope.origin))}/`
          ]
        for (const prefix of prefixes) {
          const keys = yield* substitute(storage.keys(prefix), [] as ReadonlyArray<string>, "Recollection")
          for (const key of keys) yield* swallow(storage.remove(key), "Recollection")
        }
      })

      return Recollection.of({ recall, remember, observe, latest, merge, elect, forget })
    })
  )
}

const root = "parle/recollection/"
const mentionsRoot = `${root}mentions/`
const aliasRoot = `${root}alias/`

/**
 * How far a chain of merges is followed before answering with what we have.
 *
 * **Termination is not what this buys.** The walk carries a `seen` set and every
 * hop either adds a new address to it or stops, so the walk is already finite in
 * the number of alias rows on disk — cycles included. This is a latency backstop
 * on a pathological store and nothing more.
 *
 * It has to be set well above any chain a real install can grow, because
 * stopping short does not yield a stale answer — it yields an *empty* one. A
 * merge moves the source's Mentions onward and deletes the source row, so every
 * address in the middle of a chain holds nothing; landing on one answers "this
 * page has no Discussions". That is the silent, undetectable false negative the
 * whole merge mechanism exists to prevent, and a bound low enough to be reached
 * is a way of causing it rather than a guard against it.
 *
 * Chains grow one hop per merge on one page's address history — a slug change, a
 * syndicated copy, a canonicalization rules bump — so single digits are within
 * reach of an install that lives for a year, and the cost of a hop is one
 * storage read on an address that has actually been merged.
 */
const aliasHops = 64

/**
 * The origin sits in the key path so an origin-scoped `forget` is a prefix
 * sweep rather than a scan-and-parse over every row.
 */
const mentionsKey = (subject: SubjectUrl): string =>
  `${mentionsRoot}${encodeURIComponent(originOf(subject))}/${encodeURIComponent(subject)}`

/** Where a superseded address records what it now points at. Same origin scoping. */
const aliasKey = (subject: SubjectUrl): string =>
  `${aliasRoot}${encodeURIComponent(originOf(subject))}/${encodeURIComponent(subject)}`

/**
 * Keyed on the (Network, native id) pair via `discussionKey`, never the bare id.
 * A Reddit permalink and a Hacker News item can share a string; their numbers
 * must not share a row.
 */
const observationKey = (discussion: DiscussionId): string =>
  `${root}observation/${encodeURIComponent(discussionKey(discussion))}`

/**
 * A usable address.
 *
 * Read through `unknown` on purpose: the compiler already believes this field is
 * a branded string, and the case worth catching is the one where it is wrong.
 */
const isAddress = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0

/** A Mention with no Subject URL is not stored. */
const hasSubject = (mention: Mention): boolean => isAddress(mention.subject)

/**
 * The same Mention, filed under a different address for the same page.
 *
 * `viaAlias` is deliberately *not* rewritten. It records which address the
 * Discussion actually submitted, which stays true however the Subject is later
 * re-keyed — and it is the evidence a Linked Mention rests on, so overwriting it
 * with the merge target would turn a fact into a restatement of the key.
 */
const rekey = (mention: Mention, subject: SubjectUrl): Mention => {
  if (mention.subject === subject) return mention
  switch (mention._tag) {
    case "Linked":
      return Mention.cases.Linked.make({
        subject,
        discussion: mention.discussion,
        viaAlias: mention.viaAlias
      })
    case "Passing":
      return Mention.cases.Passing.make(
        mention.inComment === undefined
          ? { subject, discussion: mention.discussion }
          : { subject, discussion: mention.discussion, inComment: mention.inComment }
      )
  }
}

/** Linked beats Passing. The ordering the X gate depends on. */
const strength = (mention: Mention): number => mention._tag === "Linked" ? 3 : mention._tag === "Passing" ? 2 : 1

/**
 * Fold arriving Mentions into what is already held, at most one per Discussion.
 *
 * A weaker tier never displaces a stronger one. Harvesting a comment page after
 * having seen the submission itself would otherwise downgrade a Linked Mention to
 * a Passing one, and that is not a cosmetic loss — it is the evidence the X gate
 * reads, so a downgrade silently closes a gate that was open.
 *
 * It is also what makes a merge idempotent: the transient duplication a merge
 * leaves behind collapses here, on the next read or write, with the stronger
 * tier surviving.
 */
const reconcile = (
  held: ReadonlyArray<typeof Kept.Type>,
  arriving: ReadonlyArray<typeof Kept.Type>
): ReadonlyArray<typeof Kept.Type> => {
  const byDiscussion = new Map<string, typeof Kept.Type>()
  for (const candidate of [...held, ...arriving]) {
    const key = discussionKey(candidate.mention.discussion)
    const incumbent = byDiscussion.get(key)
    if (incumbent === undefined) {
      byDiscussion.set(key, candidate)
      continue
    }
    const better = strength(candidate.mention) > strength(incumbent.mention) ||
      (strength(candidate.mention) === strength(incumbent.mention) &&
        candidate.rememberedAt >= incumbent.rememberedAt)
    if (better) byDiscussion.set(key, candidate)
  }
  return Array.from(byDiscussion.values())
    .sort((a, b) => strength(b.mention) - strength(a.mention) || b.rememberedAt - a.rememberedAt)
    .slice(0, mentionsPerSubject)
}

/**
 * A ceiling per Subject, because iOS Safari extension storage is the constraining
 * platform and an unbounded row is the one that gets the whole store evicted.
 * Weakest tiers and oldest evidence go first, so what survives is what the panel
 * would have shown anyway.
 */
const mentionsPerSubject = 100
