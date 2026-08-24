/**
 * The record that we *intended* to ask a Network about a Subject, and when.
 *
 * A separate store from Recollection, and the separation is the point. The two
 * have opposite privacy properties: Recollection is built by Harvest from
 * Network pages the reader had already loaded and discloses nothing extra, while
 * this is a dated record of addresses they visited — which is exactly the thing
 * a Lookup would have disclosed, written down. ADR 0012's single visible clear
 * cannot honestly cover both, so they clear separately.
 *
 * **Intent is recorded before the request, not after it.** Every design that
 * records the outcome has the same hole: MV3 kills the service worker without
 * running finalizers, so a worker that dies mid-flight leaves nothing behind, and
 * the worker that replaces it has no evidence it ever asked. Ten tabs across ten
 * worker lifetimes then get ten fresh X budgets, and ADR 0001's "a Subject URL is
 * searched on X at most once per long TTL" — listed there among "the terms on
 * which this decision is acceptable" — quietly becomes once per worker lifetime.
 * {@link LookupRecord.intend} is what closes that, and it is why the method is
 * called `intend` rather than `record`.
 *
 * **Leases expire.** The same crash that makes `intend` necessary would otherwise
 * make it permanent: an intent with no outcome, written by a worker that died,
 * would read as "already asked" forever and the Network would never be asked
 * again. So an unsettled intent is only honoured for a short window, after which
 * it stops counting. `asked` therefore answers "yes" for a Lookup in flight and
 * "no" for one that was in flight when the lights went out.
 *
 * **Keys are opaque.** This store only ever needs to *recognise* an address —
 * "did we already ask about this one?" — never to read one back, and a store that
 * never reads a value back has no business holding it. See `OpaqueKeys` for what
 * that does and does not defend against.
 *
 * **A Refusal and a Garble are not recorded, and a Withholding is not
 * representable.** The glossary is unambiguous: a Refusal is a fact about the
 * attempt and never about the Subject, and a Garble is an answer that was not
 * usable. Neither is evidence we asked and learned anything, so `settle`
 * *removes* the entry for both, and the next visit may ask again. Restraint
 * against a Network that is refusing belongs to the rate limiter and to backoff,
 * not to a store whose whole job is remembering what we learned.
 *
 * A **Withholding** is a stronger case still, and ADR 0015 calls the clause small
 * and load-bearing: it is *never stored at all*, and is recomputed on read from
 * current Coverage. A stored Withholding re-derives the X gate's decision from a
 * decision the gate itself made — the gate reads back its own "no Linked Mention
 * yet", closes, and stays closed deterministically, on every future visit,
 * forever. So {@link Settled} has no Withholding case; {@link WithholdingIsNotStorable}
 * makes adding one a compile error; and {@link LookupRecord.settleFrom} — the door
 * for callers holding Coverage's own `Consultation` — discharges a Withholding by
 * *removing* the entry rather than writing one.
 *
 * **A Silence's TTL comes from the Subject's age**, not from a constant. See
 * `SilenceTtl` for why a fixed number is wrong in both directions at once. The
 * per-Network `silenceFloor` is the one thing that overrides the ladder upwards,
 * and it exists for ADR 0001: X is searched with the reader's own account, at most
 * once per long TTL, and no page being newly published relaxes that.
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { type Consultation, type RefusalReason } from "@parle/domain/Coverage"
import { Network } from "@parle/domain/Network"
import type { SubjectUrl } from "@parle/domain/Subject"
import { readText, writeText } from "./Codec.ts"
import { OpaqueKey, OpaqueKeys, originOf, originScope } from "./OpaqueKeys.ts"
import { ageOf, type PublishedAt, silenceTtl } from "./SilenceTtl.ts"
import { Storage, substitute, swallow } from "./Storage.ts"

/** When a Lookup was intended, in epoch milliseconds. */
export const AskedAt = Schema.Number.pipe(Schema.brand("AskedAt"))
export type AskedAt = typeof AskedAt.Type

/**
 * Permission to have one Lookup outstanding, and the obligation to settle it.
 *
 * Carries its own concealed keys so `settle` needs neither the address nor the
 * salt — the caller holding a Lease holds nothing that identifies the page.
 */
export class Lease extends Schema.Opaque<Lease, { readonly _brand: "Lease" }>()(
  Schema.Struct({
    origin: OpaqueKey,
    ask: OpaqueKey,
    network: Network,
    intendedAt: Schema.Number,
    expiresAt: Schema.Number
  })
) {}

/**
 * What became of a Lookup, of the outcomes it is ever safe to write down.
 *
 * Mirrors Coverage's vocabulary rather than reusing `Consultation`, which
 * carries Mentions this store must never hold — and, more importantly, carries a
 * `Withholding`, which this store must never hold either.
 */
export type Settled =
  | { readonly _tag: "Answered"; readonly mentions: number }
  | {
    readonly _tag: "Silence"
    /**
     * When the Subject was published, where we know it, in epoch milliseconds.
     *
     * Optional because it is genuinely often unknown — and omitting it is not
     * the convenient choice: an unknown age takes the *shortest* rung of the
     * ladder, so a caller that cannot supply a date pays for it in extra
     * Lookups rather than in a Silence believed past its usefulness.
     */
    readonly publishedAt?: PublishedAt | undefined
  }
  | { readonly _tag: "Refusal"; readonly reason: RefusalReason }
  | { readonly _tag: "Garble" }

/**
 * Compile-time proof that a Withholding is not a storable outcome.
 *
 * `MustBeNever` accepts only `never`, so the day someone adds a `Withholding`
 * case to {@link Settled} — or widens it to `Consultation`, which is the likelier
 * accident — this alias stops compiling and says why. A comment saying "do not
 * store Withholdings" would survive that edit; this does not.
 */
type MustBeNever<T extends never> = T
export type WithholdingIsNotStorable = MustBeNever<Extract<Settled, { readonly _tag: "Withholding" }>>

/** How much of the Lookup Record to clear. */
export type Forgetting =
  | { readonly _tag: "All" }
  | { readonly _tag: "Origin"; readonly origin: string }

/**
 * How long an intent, and an answer, are honoured.
 *
 * `lease` is short — long enough that a Lookup in flight is not asked twice by a
 * second tab, short enough that a crash costs one long-TTL window and not the
 * feature. The per-Network `asked` retentions are the "cache hard" lever for an
 * *answer*: X is asked far less often than the others because it is asked with
 * the reader's own account.
 *
 * `silenceFloor` is not a fourth TTL, it is a lower bound on the one `SilenceTtl`
 * derives. A Silence's life is a property of the page, but a Lookup's *frequency*
 * is also a property of the Network we would be asking, and for X that is
 * ADR 0001's term — "a Subject URL is searched on X at most once per long TTL" —
 * which a page published this morning does not get to relax. Hacker News and
 * Reddit have no such term, so their floor is zero and the ladder governs alone.
 */
export interface Retention {
  readonly lease: Duration.Duration
  readonly asked: { readonly [K in Network]: Duration.Duration }
  readonly silenceFloor: { readonly [K in Network]: Duration.Duration }
}

export const defaultRetention: Retention = {
  lease: Duration.minutes(2),
  asked: {
    hackernews: Duration.hours(6),
    reddit: Duration.hours(6),
    x: Duration.days(7),
    bluesky: Duration.hours(6),
    lemmy: Duration.hours(6),
    // Volunteer-run Rails site with no rate-limit docs; politeness is on us,
    // so an answer is honoured twice as long as the commercial Networks'.
    lobsters: Duration.hours(12)
  },
  silenceFloor: {
    hackernews: Duration.zero,
    reddit: Duration.zero,
    x: Duration.days(7),
    bluesky: Duration.zero,
    lemmy: Duration.zero,
    lobsters: Duration.zero
  }
}

/** What is actually written under an opaque key: an intent, or an answer. */
const Entry = Schema.TaggedUnion({
  /** Written before the request. Honoured only until `expiresAt`. */
  Intended: { intendedAt: Schema.Number, expiresAt: Schema.Number },
  /** Written after an Answer or a Silence. Never after a Refusal or a Garble. */
  Asked: { askedAt: Schema.Number, keepUntil: Schema.Number }
})

/**
 * What the record offers, as a named interface rather than inline in the class.
 *
 * Named for the reason `Board`'s shape is (see `apps/extension`'s
 * `reading/Board.ts`): past a certain size TypeScript resolves an inline
 * `Context.Service` shape while still computing the class's own base type,
 * gives up, and reports TS2310 "recursively references itself" with no
 * indication of what overflowed. Adding {@link LookupRecordShape.intended} is
 * what tipped this one over.
 */
export interface LookupRecordShape {
  /** Record the intent to ask, *before* issuing the request. */
  readonly intend: (subject: SubjectUrl, network: Network) => Effect.Effect<Lease>
  /** Discharge an intent with what came back. Answers persist; Refusals do not. */
  readonly settle: (lease: Lease, outcome: Settled) => Effect.Effect<void>
  /**
   * Discharge an intent from Coverage's own vocabulary.
   *
   * The door for a caller holding a `Consultation`, and the reason it exists is
   * the one outcome it refuses: a `Withholding` discharges the Lease and writes
   * *nothing*, so a Lookup we deliberately did not issue leaves no trace that a
   * later read could mistake for one we did. `Pending` and `Asking` are treated
   * the same way — a Lookup that has not finished is not an outcome — which
   * makes this total over `Consultation` with no case left to forget.
   *
   * `publishedAt` is used only for a Silence; every other outcome ignores it.
   */
  readonly settleFrom: (
    lease: Lease,
    consultation: Consultation,
    publishedAt?: PublishedAt | undefined
  ) => Effect.Effect<void>
  /** When this Lookup was last asked, counting one still in flight. */
  readonly asked: (
    subject: SubjectUrl,
    network: Network
  ) => Effect.Effect<Option.Option<AskedAt>>
  /**
   * Whether an unexpired intent is on record: this same Lookup is in flight
   * somewhere, or its asker was killed inside the lease window.
   *
   * Distinct from {@link LookupRecord.asked}, which also honours settled
   * answers, and the distinction is what makes gating on THIS safe under
   * ADR 0005: a caller that skips a re-ask because of an unexpired lease is
   * declining to pay twice for a request that is already being paid for, never
   * withholding on the strength of an answer it cannot re-render. It is the
   * check that stops a crash-looping worker from spending one fresh request
   * budget per lifetime — ten kills in a row cost one lease window, not ten
   * budgets.
   */
  readonly intended: (
    subject: SubjectUrl,
    network: Network
  ) => Effect.Effect<boolean>
  readonly forget: (scope: Forgetting) => Effect.Effect<void>
}

/** Kept only so we do not ask again. */
export class LookupRecord extends Context.Service<LookupRecord, LookupRecordShape>()("parle/memory/LookupRecord") {
  static readonly layerWith = (
    retention: Retention
  ): Layer.Layer<LookupRecord, never, Storage | OpaqueKeys> =>
    Layer.effect(LookupRecord)(Effect.gen(function*() {
      const storage = yield* Storage
      const keys = yield* OpaqueKeys

      const pathFor = Effect.fn("LookupRecord.pathFor")(function*(
        subject: SubjectUrl,
        network: Network
      ) {
        const origin = yield* keys.conceal(`origin ${originOf(subject)}`)
        const ask = yield* keys.conceal(`ask ${subject} ${network}`)
        return { origin, ask, path: pathOf(origin, ask) }
      })

      const load = (path: string): Effect.Effect<Option.Option<typeof Entry.Type>> =>
        Effect.gen(function*() {
          const raw = yield* substitute(storage.get(path), Option.none<string>(), "LookupRecord")
          if (Option.isNone(raw)) return Option.none<typeof Entry.Type>()
          return yield* readText(Entry, raw.value, "LookupRecord")
        })

      const intend = Effect.fn("LookupRecord.intend")(function*(
        subject: SubjectUrl,
        network: Network
      ) {
        const { ask, origin, path } = yield* pathFor(subject, network)
        const now = yield* Clock.currentTimeMillis
        const lease = Lease.make({
          origin,
          ask,
          network,
          intendedAt: now,
          expiresAt: now + Duration.toMillis(retention.lease)
        })

        // A live answer is not overwritten by a fresh intent. Two tabs racing on
        // one Subject would otherwise replace a settled record with a two-minute
        // lease, and the second tab's crash would then reopen the window the
        // first tab had already closed.
        const held = yield* load(path)
        if (Option.isSome(held) && held.value._tag === "Asked" && held.value.keepUntil > now) {
          return lease
        }

        const text = yield* writeText(
          Entry,
          Entry.cases.Intended.make({ intendedAt: lease.intendedAt, expiresAt: lease.expiresAt }),
          "LookupRecord"
        )
        if (Option.isSome(text)) yield* swallow(storage.set(path, text.value), "LookupRecord")
        return lease
      })

      const settle = Effect.fn("LookupRecord.settle")(function*(lease: Lease, outcome: Settled) {
        const path = pathOf(lease.origin, lease.ask)
        if (outcome._tag === "Refusal" || outcome._tag === "Garble") {
          // Never cached. Nothing was learned about the Subject, so nothing is
          // remembered about having asked.
          yield* swallow(storage.remove(path), "LookupRecord")
          return
        }
        const now = yield* Clock.currentTimeMillis
        // An Answer keeps for as long as this Network's answers are worth
        // keeping. A Silence keeps for as long as *this page* can go on having
        // nothing said about it — which is the only one of the two that is a
        // claim about the world, and so the only one whose staleness can put a
        // gate the wrong way round.
        const keepFor = outcome._tag === "Silence"
          ? Duration.max(
            retention.silenceFloor[lease.network],
            silenceTtl(ageOf(Option.fromNullishOr(outcome.publishedAt), now))
          )
          : retention.asked[lease.network]
        const text = yield* writeText(
          Entry,
          Entry.cases.Asked.make({
            askedAt: lease.intendedAt,
            keepUntil: now + Duration.toMillis(keepFor)
          }),
          "LookupRecord"
        )
        if (Option.isSome(text)) yield* swallow(storage.set(path, text.value), "LookupRecord")
      })

      const settleFrom = Effect.fn("LookupRecord.settleFrom")(function*(
        lease: Lease,
        consultation: Consultation,
        publishedAt?: PublishedAt | undefined
      ) {
        if (!answers(lease, consultation)) {
          yield* Effect.logWarning(
            "LookupRecord was handed a Consultation from a Place this Lease was not issued for"
          )
          yield* swallow(storage.remove(pathOf(lease.origin, lease.ask)), "LookupRecord")
          return
        }
        const storable = storableOutcome(consultation, publishedAt)
        if (Option.isNone(storable)) {
          // A Withholding, or a Lookup that never finished. Discharge the Lease
          // by clearing it: the next visit recomputes the Withholding from
          // current Coverage, which is the whole of ADR 0015's argument. Leaving
          // the intent in place would be almost as bad as storing the
          // Withholding itself — it would read as "asked" until the lease ran
          // out, on a Lookup that was never issued.
          yield* swallow(storage.remove(pathOf(lease.origin, lease.ask)), "LookupRecord")
          return
        }
        yield* settle(lease, storable.value)
      })

      const asked = Effect.fn("LookupRecord.asked")(function*(
        subject: SubjectUrl,
        network: Network
      ) {
        const { path } = yield* pathFor(subject, network)
        const held = yield* load(path)
        if (Option.isNone(held)) return Option.none<AskedAt>()
        const now = yield* Clock.currentTimeMillis
        const entry = held.value
        if (entry._tag === "Asked") {
          return entry.keepUntil > now ? Option.some(AskedAt.make(entry.askedAt)) : Option.none<AskedAt>()
        }
        // An unexpired intent counts: the Lookup is in flight in some other tab
        // and asking again would spend the budget twice. An expired one does not:
        // the worker that wrote it died, and nobody is ever going to settle it.
        return entry.expiresAt > now ? Option.some(AskedAt.make(entry.intendedAt)) : Option.none<AskedAt>()
      })

      const intended = Effect.fn("LookupRecord.intended")(function*(
        subject: SubjectUrl,
        network: Network
      ) {
        const { path } = yield* pathFor(subject, network)
        const held = yield* load(path)
        if (Option.isNone(held) || held.value._tag !== "Intended") return false
        return held.value.expiresAt > (yield* Clock.currentTimeMillis)
      })

      const forget = Effect.fn("LookupRecord.forget")(function*(scope: Forgetting) {
        // Opaque keys cannot be scanned, so "clear this site" is answered by the
        // concealed origin sitting in the key path — the reason it is there.
        // `originScope` for the same reason `pathFor` uses `originOf`: the two
        // must agree exactly or the sweep matches nothing and says so to nobody.
        const prefix = scope._tag === "All"
          ? root
          : `${root}${yield* keys.conceal(`origin ${originScope(scope.origin)}`)}/`
        const found = yield* substitute(storage.keys(prefix), [] as ReadonlyArray<string>, "LookupRecord")
        for (const key of found) yield* swallow(storage.remove(key), "LookupRecord")
      })

      return LookupRecord.of({ intend, settle, settleFrom, asked, intended, forget })
    }))

  static readonly layer: Layer.Layer<LookupRecord, never, Storage | OpaqueKeys> = LookupRecord.layerWith(
    defaultRetention
  )
}

const root = "parle/lookup/"

const pathOf = (origin: OpaqueKey, ask: OpaqueKey): string => `${root}${origin}/${ask}`

/**
 * Whether this Consultation is an answer to the Lookup this Lease was issued for.
 *
 * A `Consultation` carries its own `Place`, and a Coverage carries every Place in
 * one array — so `settleFrom` is one index slip away from writing Hacker News's
 * answer under X's key. Nothing about the types stops it: both sides typecheck,
 * both are `Consultation`, and the Lease deliberately carries no address to
 * compare against.
 *
 * The consequence is not a mis-filed row, it is a closed gate. X's retention is
 * seven days, so a Consultation from somewhere else settled under an X Lease
 * makes `asked` report X as already asked for a week, on evidence that never
 * came from X — which is ADR 0015's "a Silence trusted for too long silently
 * re-derives the gate's decision", reached by a different road. `Place.Recall` is
 * the worst of them: the reader's own machine answering is not a Lookup at all,
 * and recording it as one says we sent an address to a Network we never
 * contacted.
 *
 * A mismatch is discharged the way a Withholding is — the entry is *removed* —
 * because the safe direction is always "we have no evidence we asked". That
 * costs one Lookup; the other direction costs a week of X coverage.
 */
const answers = (lease: Lease, consultation: Consultation): boolean =>
  consultation.place._tag === "Network" &&
  consultation.place.network === lease.network

/**
 * The storable outcome in a Consultation, if there is one.
 *
 * Total over every `Consultation` case, and exhaustive by `switch` rather than by
 * a default arm — adding a seventh Consultation tag upstream must make this stop
 * compiling and force a decision about whether it is evidence, rather than
 * silently falling into "store nothing" or, worse, "store something".
 *
 * `Withholding` returns `Option.none`, and so do `Pending` and `Asking`, and so
 * does a **windowed Silence** — see below. The Mentions on an `Answered` are
 * counted and discarded: this store holds no pointers to Discussions, only the
 * fact that a question was answered.
 */
const storableOutcome = (
  consultation: Consultation,
  publishedAt?: PublishedAt | undefined
): Option.Option<Settled> => {
  switch (consultation._tag) {
    case "Answered":
      return Option.some({ _tag: "Answered", mentions: consultation.mentions.length })
    case "Silence":
      // A Silence off a filled window is not a Silence. It says "none of the
      // first fifty hits we looked at was this page", and the Network said
      // there were more than fifty. Cached, that becomes "nobody discussed
      // this page" for as long as `silenceTtl` allows — a silent false
      // negative that is then *durable*, which is the one thing ADR 0005
      // refuses. Kept out of the store entirely rather than given a shorter
      // TTL: a shorter TTL still asserts the claim, only for less time.
      if (consultation.windowed === true) return Option.none()
      return Option.some(
        publishedAt === undefined ? { _tag: "Silence" } : { _tag: "Silence", publishedAt }
      )
    case "Refusal":
      return Option.some({ _tag: "Refusal", reason: consultation.reason })
    case "Garble":
      return Option.some({ _tag: "Garble" })
    case "Withholding":
    case "Pending":
    case "Asking":
      return Option.none()
  }
}
