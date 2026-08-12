/**
 * Where a link seen on a Network page is turned into the key a Mention is
 * stored under.
 *
 * This is the load-bearing service of ADR 0012. The decision it implements is
 * one sentence long — "resolve shortlinks and tracking redirects to their
 * destination **at harvest time**, and key the cache on the canonical
 * destination" — and everything else in this file exists because the ADR's
 * final consequence attaches a price to it: "shortlink resolution at harvest
 * time costs a request per unresolved link. It must be batched, cached, and
 * capped, or harvesting a busy timeline becomes its own traffic problem."
 *
 * So: **cached**, by {@link Cache} keyed on the raw href, with a time to live
 * read off the answer rather than fixed — a `t.co` token maps to one
 * destination for as long as `t.co` exists, whereas "we could not hear an
 * answer" is worth ten minutes and "we chose not to ask" is worth nothing at
 * all and must never be written down. **Batched**, by `destinationsOf`, which
 * dedupes within a page before it spends anything: a timeline that shows the
 * same article in six posts costs one request, not six. **Capped**, by a
 * request budget over a rolling window, which is the only thing standing
 * between a reader scrolling X for an hour and a crawler.
 *
 * **Totality is the whole design.** `destinationOf` cannot fail, and the answer
 * for every link that could not be followed still carries a `SubjectUrl` — the
 * canonicalized shortlink. A Mention keyed on a `t.co` address is a Mention on
 * a key the reader will probably never land on, which is a miss; a Mention that
 * was never written is a Discussion this machine has silently decided does not
 * exist, which is the invisible false negative the whole project is arranged
 * against. The first is recoverable and the second is not — but be exact about
 * what "recoverable" currently means: the next harvest that sees the same
 * shortlink and gets an answer writes a Mention on the right key, so the reader
 * gets the Discussion. The stale Mention on the shortlink key stays where it
 * is. Re-keying it is `Recollection.merge`, which nothing in this package calls
 * yet, and until something does, an unresolved harvest leaves a dead entry
 * behind as well as a repaired one.
 *
 * That is why `Unresolved` and `Resolved` are not interchangeable and why
 * {@link ./Redirects.ts} may never return the address it asked about as the
 * address it found: an `Unresolved` on the shortlink key is marked, expires in
 * minutes or hours, and is retried. A `Resolved` on the shortlink key is a
 * week-long lie that nothing downstream can tell from a destination.
 *
 * Every `SubjectUrl` here comes from {@link SubjectIdentity}. Minting one
 * locally would produce keys under a rules version nothing else in the system
 * shares, and the failure would be silent: a perfectly populated cache that
 * never hits.
 */
import * as Cache from "effect/Cache"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import { SubjectIdentity } from "@parle/policy/SubjectIdentity"
import { Redirects } from "./Redirects.ts"
import { Resolution } from "./Resolution.ts"
import { isShortener, unwrapFully } from "./Shortlinks.ts"

/**
 * How many requests harvesting may spend, and over what.
 *
 * A rolling window rather than a fixed interval, for the reason ADR 0012 gives
 * for prefetch: the thing worth bounding is total traffic, not cadence. A
 * reader who opens Hacker News once a day should get every link on it resolved;
 * a reader who scrolls X for an hour should not get forty requests a minute.
 *
 * `demand` is a second, smaller allowance that only `urgentlyOf` spends:
 * resolutions the reader is *standing on*, asked for through the Harvester's
 * demand channel. It is separate because it is the one case where the request
 * discloses nothing new — the reader's own browser has already been to the
 * destination — so charging it against the politeness budget would let
 * background harvesting starve the only resolution anybody is waiting for.
 */
export interface Budget {
  readonly requests: number
  readonly window: Duration.Duration
  readonly demand: number
}

export const defaultBudget: Budget = {
  requests: 150,
  window: Duration.hours(1),
  demand: 20
}

/** How long an answer is worth keeping. Read off the answer, never fixed. */
const timeToLive = (resolution: Resolution): Duration.Duration => {
  switch (resolution._tag) {
    // A shortlink token is permanent by construction; a direct link needed no
    // request and re-deriving it is nearly free, so a week suits both.
    case "Resolved":
      return Duration.days(7)
    case "NotASubject":
      return Duration.days(7)
    case "Unresolved":
      switch (resolution.why) {
        // A fact about the attempt, never about the link. Worth retrying, and
        // worth not retrying forty times in the same scroll.
        case "Refusal":
          return Duration.minutes(10)
        // An answer we could not use. Not retried inside a harvest; a day is
        // long enough that a broken redirector is not hammered and short
        // enough that a fixed one is picked up.
        case "Garble":
          return Duration.hours(24)
        // Never cached. This says nothing about the link — only that our budget
        // was spent at one moment — and remembering it would turn one busy
        // afternoon into a permanent blind spot for every link on it.
        case "Withholding":
          return Duration.zero
      }
  }
}

/** What a budget looks like part-way through a window. */
interface Spending {
  readonly requests: number
  readonly demand: number
  readonly windowStartMillis: number
}

const fresh = (nowMillis: number): Spending => ({ requests: 0, demand: 0, windowStartMillis: nowMillis })

export class LinkResolver extends Context.Service<LinkResolver, {
  /**
   * The destination a link points at, and therefore the key its Mention is
   * stored under. Never fails, never returns nothing.
   */
  readonly destinationOf: (raw: string) => Effect.Effect<Resolution>
  /**
   * Resolve a page's links as one batch: deduped, and bounded in concurrency.
   *
   * The dedupe is explicit rather than left to `Cache`'s collapsing of
   * concurrent lookups, because that collapsing depends on the duplicates
   * being in flight at the same moment — which depends on the concurrency
   * limit, the order the page listed them in, and how fast the first one
   * answered. A page that shows one article six times must cost one request
   * for reasons that are in this file, not reasons that are in a race.
   */
  readonly destinationsOf: (raws: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<Resolution>>
  /**
   * Resolve as though the reader were waiting, spending the demand allowance.
   *
   * Used by {@link ../Harvester.ts}'s demand channel only.
   */
  readonly urgentlyOf: (raws: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<Resolution>>
  /**
   * Record a destination the reader's own browser already reached.
   *
   * This is the free resolution: a navigation the browser performed is itself
   * evidence of where a link goes, obtained at no cost and with no disclosure,
   * so it back-fills the cache and every later harvest of the same shortlink is
   * answered from it. Total, and deliberately unable to report failure — an
   * address the canonicalizer will not mint simply teaches us nothing.
   */
  readonly learn: (raw: string, destination: string) => Effect.Effect<void>
  /** Requests left in this window. Exposed so the cap is observable, not folklore. */
  readonly remaining: Effect.Effect<number>
}>()("parle/harvest/LinkResolver") {
  static readonly layerWith = (
    budget: Budget
  ): Layer.Layer<LinkResolver, never, SubjectIdentity | Redirects> =>
    Layer.effect(
      LinkResolver,
      Effect.gen(function*() {
        const identity = yield* SubjectIdentity
        const redirects = yield* Redirects
        const now = yield* Clock.currentTimeMillis
        const spending = yield* Ref.make(fresh(now))

        const windowMillis = Duration.toMillis(budget.window)

        /**
         * Take one request from an allowance, rolling the window if it has run
         * out. Returns whether the request may be made.
         *
         * The claim is taken BEFORE the request rather than after it, because
         * MV3 kills the worker mid-flight: a budget decremented on completion
         * is a budget that forgets everything in flight when the worker dies,
         * and the next lifetime starts spending again from zero.
         */
        const claim = (urgent: boolean) =>
          Effect.gen(function*() {
            const at = yield* Clock.currentTimeMillis
            return yield* Ref.modify(spending, (current) => {
              const rolled = at - current.windowStartMillis >= windowMillis ? fresh(at) : current
              const cap = urgent ? budget.demand : budget.requests
              const taken = urgent ? rolled.demand : rolled.requests
              if (taken >= cap) return [false, rolled] as const
              return [
                true,
                urgent
                  ? { ...rolled, demand: rolled.demand + 1 }
                  : { ...rolled, requests: rolled.requests + 1 }
              ] as const
            })
          })

        /** Charge what a completed attempt actually cost, beyond the one claimed. */
        const charge = (requests: number, urgent: boolean) =>
          Ref.update(spending, (current) => {
            const extra = Math.max(0, requests - 1)
            return urgent
              ? { ...current, demand: current.demand + extra }
              : { ...current, requests: current.requests + extra }
          })

        const resolve = Effect.fn("LinkResolver.resolve")(function*(key: string) {
          const { raw, urgent } = readKey(key)
          // Free unwrapping first, always. A `out.reddit.com/?url=…` carries its
          // own destination and must never cost a request; doing this before
          // the shortener test also means a wrapper pointing AT a shortener is
          // recognised as the shortener it is.
          const unwrapped = unwrapFully(raw)
          const near = yield* identity.identify(unwrapped)
          if (Option.isNone(near)) {
            return Resolution.cases.NotASubject.make({ raw })
          }
          if (!isShortener(unwrapped)) {
            return Resolution.cases.Resolved.make({ raw, subject: near.value, requests: 0 })
          }

          const permitted = yield* claim(urgent)
          if (!permitted) {
            return Resolution.cases.Unresolved.make({ raw, subject: near.value, why: "Withholding" })
          }
          const trail = yield* redirects.follow(unwrapped)
          yield* charge(trail.requests, urgent)
          if (trail._tag === "Lost") {
            return Resolution.cases.Unresolved.make({ raw, subject: near.value, why: trail.why })
          }
          const landed = yield* identity.identify(unwrapFully(trail.url))
          if (Option.isNone(landed)) {
            // The redirector answered and the answer named something that is
            // not a page. That is a Garble, not a destination, and emphatically
            // not a reason to drop the Mention.
            return Resolution.cases.Unresolved.make({ raw, subject: near.value, why: "Garble" })
          }
          return Resolution.cases.Resolved.make({ raw, subject: landed.value, requests: trail.requests })
        })

        const cache = yield* Cache.makeWith(resolve, {
          // Sized for a busy timeline plus the pages either side of it. The
          // entries are three short strings; the bound exists for the iOS
          // build, where ADR 0012 says storage is the constraining platform.
          capacity: 4096,
          timeToLive: (exit: Exit.Exit<Resolution>) =>
            Exit.isSuccess(exit) ? timeToLive(exit.value) : Duration.zero
        })

        /**
         * One answer for one link, on one allowance — reusing the other
         * allowance's answer rather than paying for it twice.
         *
         * The two key spaces exist only so that a `Withholding` taken against
         * one allowance is never served to the other. Every OTHER answer is a
         * property of the link and not of the budget that happened to pay for
         * it, so it is mirrored across. Without this, `Harvester.prioritise`
         * resolving a link urgently left the background path to resolve the
         * same link again from scratch: two requests for one `t.co`, which is
         * exactly the doubling ADR 0012's "batched, cached, and capped" is
         * about. A `Withholding` is never mirrored and never stored, so the
         * isolation the split was built for is untouched.
         */
        const lookup = (raw: string, urgent: boolean) =>
          Effect.gen(function*() {
            const elsewhere = yield* Cache.getOption(cache, writeKey(raw, !urgent))
            if (Option.isSome(elsewhere)) return elsewhere.value
            const found = yield* Cache.get(cache, writeKey(raw, urgent))
            const withheld = found._tag === "Unresolved" && found.why === "Withholding"
            if (!withheld) yield* Cache.set(cache, writeKey(raw, !urgent), found)
            return found
          })

        const destinationOf = Effect.fn("LinkResolver.destinationOf")(function*(raw: string) {
          return yield* lookup(raw, false)
        })

        const batch = (raws: ReadonlyArray<string>, urgent: boolean) =>
          Effect.gen(function*() {
            const unique = [...new Set(raws)]
            const answers = yield* Effect.forEach(
              unique,
              (raw) => Effect.map(lookup(raw, urgent), (found) => [raw, found] as const),
              // Four at a time: enough that a page of links resolves while the
              // reader is still reading it, few enough that no Network sees a
              // burst it would be right to call abuse.
              { concurrency: 4 }
            )
            const byRaw = new Map(answers)
            return raws.map((raw) =>
              // The fallback is unreachable — `unique` is `raws` deduped — and
              // is written rather than asserted because a resolver that can
              // throw is a harvest that can take Recollection down with it.
              byRaw.get(raw) ?? Resolution.cases.NotASubject.make({ raw })
            )
          })

        const destinationsOf = Effect.fn("LinkResolver.destinationsOf")(function*(raws: ReadonlyArray<string>) {
          return yield* batch(raws, false)
        })

        const urgentlyOf = Effect.fn("LinkResolver.urgentlyOf")(function*(raws: ReadonlyArray<string>) {
          return yield* batch(raws, true)
        })

        const learn = Effect.fn("LinkResolver.learn")(function*(raw: string, destination: string) {
          const landed = yield* identity.identify(unwrapFully(destination))
          if (Option.isNone(landed)) return
          const free = Resolution.cases.Resolved.make({ raw, subject: landed.value, requests: 0 })
          // Both allowances. Free evidence is free on either one, and writing
          // it to only the background key left the demand path paying for a
          // destination the reader's own browser had already reached.
          yield* Cache.set(cache, writeKey(raw, false), free)
          yield* Cache.set(cache, writeKey(raw, true), free)
        })

        const remaining = Effect.gen(function*() {
          const at = yield* Clock.currentTimeMillis
          const current = yield* Ref.get(spending)
          if (at - current.windowStartMillis >= windowMillis) return budget.requests
          return Math.max(0, budget.requests - current.requests)
        })

        return LinkResolver.of({ destinationOf, destinationsOf, urgentlyOf, learn, remaining })
      })
    )

  static readonly layer: Layer.Layer<LinkResolver, never, SubjectIdentity | Redirects> = LinkResolver.layerWith(
    defaultBudget
  )
}

/**
 * The cache key: a string, and the allowance folded into it.
 *
 * A string rather than a `{ raw, urgent }` record because a `Cache` keyed on
 * object literals compares them by identity — every call site would build a
 * fresh object and every lookup would miss, producing a cache that is
 * indistinguishable from a working one except that it never saves a request.
 *
 * Folding `urgent` into the key buys one property and one only: a Withholding
 * taken against the demand allowance is never served to the background path as
 * though the harvest budget were spent. It buys nothing else, and it must not
 * be allowed to cost anything else — an answer is a property of the link, not
 * of the allowance that paid for it, so `lookup` mirrors every non-Withholding
 * answer into the sibling key. Left unmirrored, the split silently doubled the
 * price of every link the demand channel touched.
 *
 * The separator is the first character, because an href can contain anything
 * at all except a leading byte we chose.
 */
const writeKey = (raw: string, urgent: boolean): string => (urgent ? "!" : "-") + raw

const readKey = (key: string) => ({
  raw: key.slice(1),
  urgent: key.charAt(0) === "!"
})
