/**
 * Where the pipeline becomes state, and the only place the two lifetimes meet.
 *
 * Surfaces read **state, never events**. That is the whole reason this exists
 * as a `SubscriptionRef` rather than a message stream: `changes` hands a new
 * subscriber the current value before any update, so a panel opened three
 * seconds into an Enquiry is correct rather than empty, and there is no replay
 * buffer whose size is a tuning constant nobody will revisit.
 *
 * Two lifetimes cross here and they are not the same shape. The Reading belongs
 * to the tab and ends when the address changes. The Enquiry belongs to the
 * Subject, is shared by every surface on it, and outlives any one Reading — so
 * a Reading holds a *subscription* to an Enquiry, not the Enquiry itself, and
 * dropping the subscription is how a tab says it has stopped watching. The
 * Enquiry ends when the last one lets go and the idle window passes.
 *
 * There is deliberately no horizon here. ADR 0007 was amended on 2026-08-08 to
 * delete the reader-facing Delta and the Last Look it was measured against: a
 * Digest is the current summary of the whole of a Subject's Discussions, and
 * the reader is never shown a diff against an earlier one. A `shown` event that
 * advanced a horizon nothing reads would be machinery that looks load-bearing.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { Arrival, SubjectUrl } from "@parle/domain/Subject"
import { noSignals } from "@parle/policy/Exclusion"
import { ExclusionList } from "@parle/policy/ExclusionList"
import { SubjectIdentity } from "@parle/policy/SubjectIdentity"
import { Enquiry } from "../enquiry/Enquiry.ts"
import { begin, type Knowledge } from "../enquiry/Knowledge.ts"
import { groundWords } from "../policy/Grounds.ts"
import { Reading, Standing, unopened } from "./Reading.ts"

const subjectOf = (reading: Reading): SubjectUrl | null =>
  reading.standing._tag === "Enquiring" ? reading.standing.subject : null

/**
 * What a Board offers, as a named interface rather than inline in the class.
 *
 * The pattern everywhere else in the repo is to write the shape inside
 * `Context.Service<Self, { … }>`. Here that is not available, and the reason is
 * worth stating so nobody helpfully inlines it again. `Reading` is a `Schema`
 * type and it transitively carries the whole of `Knowledge` — Coverage, every
 * Discussion, every Observation, and the Digest with its Findings and their
 * Citations. Written inline, the shape is resolved while TypeScript is still
 * computing `Board`'s own base type, and past a certain size it gives up and
 * reports the class as recursively referencing itself (TS2310) with no
 * indication of what actually overflowed. Naming the interface resolves it
 * once, before the class exists, and the error disappears.
 *
 * The `Reading` in question grew when the Digest was wired: `DigestStanding`
 * gained the states a Digest actually has. That is the immediate cause, but the
 * fragility was always there — the next field added to Knowledge would have
 * found it — so this is the fix rather than a smaller Digest.
 */
export interface BoardShape {
  /** The state of one tab's Reading, created on first ask. */
  readonly open: (tabId: number) => Effect.Effect<SubscriptionRef.SubscriptionRef<Reading>>
  /** An address settled in a tab's top frame. Starts or rejoins an Enquiry. */
  readonly sight: (
    tabId: number,
    address: string,
    title: string,
    arrival: Arrival,
    /**
     * The addresses the browser passed through to get here, oldest first.
     * Empty on an ordinary page load, which is nearly every one.
     */
    traversed?: ReadonlyArray<string>
  ) => Effect.Effect<void>
  /**
   * The reader asked about this tab, on purpose.
   *
   * ADR 0005: opening the extension on a page always performs a Lookup, and the
   * toolbar may never say "not applicable". This is the whole of that path —
   * it re-runs the Places that were withheld, on the reader's own initiative,
   * which is what overrides the Exclusion List, a per-site pause, manual mode
   * and ADR 0001's X gate.
   *
   * Nothing happens on a tab that has no Subject: an address that is not a
   * public web page has no Enquiry to insist on, and inventing one would mean
   * issuing a Lookup for `chrome://settings`.
   */
  readonly insist: (tabId: number) => Effect.Effect<void>
  /**
   * The reader asked for a Digest of this tab's Subject.
   *
   * A third act, separate from {@link Board.insist} because it costs something
   * different: insisting re-runs Lookups that were withheld, and this reads the
   * comment bodies of the Discussions those Lookups found, then spends the
   * reader's own Provider quota on them. Nothing about a page load may reach
   * here.
   */
  readonly summarise: (tabId: number) => Effect.Effect<void>
  /** The tab is gone. Releases its hold on the Enquiry. */
  readonly close: (tabId: number) => Effect.Effect<void>
}

export class Board extends Context.Service<Board, BoardShape>()("parle/reading/Board") {
  static readonly layer: Layer.Layer<
    Board,
    never,
    SubjectIdentity | ExclusionList | Enquiry
  > = Layer.effect(
    Board,
    Effect.gen(function*() {
      const identity = yield* SubjectIdentity
      const exclusions = yield* ExclusionList
      const enquiry = yield* Enquiry
      const scope = yield* Effect.scope

      /**
       * Which rule of the Exclusion List covers this address, in plain words.
       *
       * Asked here rather than carried out of `LookupPolicy`, because the rule
       * that fired cannot travel with the decision: `Coverage`'s vocabulary has
       * one literal for "excluded" and `@parle/domain` is closed. It is the
       * same `ExclusionList` service and the same layer instance the policy
       * decides against, so the two cannot disagree about what is on it — and
       * `noSignals` is passed for the same reason `LookupPolicy.wouldAutoLookUp`
       * does: nothing in this build reads the page's `<head>`.
       *
       * A page nothing excludes gets `null`, and the panel says something true
       * and general rather than dressing up an absence.
       */
      const groundFor = Effect.fn("Board.groundFor")(function*(address: string) {
        const exclusion = yield* exclusions.excludes(address, noSignals)
        return Option.isNone(exclusion) ? null : groundWords(exclusion.value)
      })

      const readings = new Map<number, SubscriptionRef.SubscriptionRef<Reading>>()
      const watchers = new Map<number, Fiber.Fiber<void>>()

      const open = Effect.fn("Board.open")(function*(tabId: number) {
        const standing = readings.get(tabId)
        if (standing !== undefined) return standing
        const made = yield* SubscriptionRef.make(unopened)
        // Re-check: making the ref suspends, and a tab can be opened by its
        // usher and by a surface in the same instant. Two refs for one tab is
        // the invisible version of this bug — the panel subscribes to one and
        // every update lands on the other.
        const raced = readings.get(tabId)
        if (raced !== undefined) return raced
        readings.set(tabId, made)
        return made
      })

      const release = Effect.fn("Board.release")(function*(tabId: number) {
        const watcher = watchers.get(tabId)
        if (watcher === undefined) return
        watchers.delete(tabId)
        // Interrupting closes the scope the Enquiry subscription was taken in,
        // which is what decrements its refcount. Nothing else here knows how
        // many surfaces an Enquiry has.
        yield* Fiber.interrupt(watcher)
      })

      const sight = Effect.fn("Board.sight")(function*(
        tabId: number,
        address: string,
        title: string,
        arrival: Arrival,
        traversed: ReadonlyArray<string> = []
      ) {
        const ref = yield* open(tabId)
        const before = yield* SubscriptionRef.get(ref)
        const elected = yield* identity.identify(address)

        // A title change, a fragment, or a query the rules already discard must
        // not tear down an Enquiry that is mid-flight — that is the ordinary
        // single-page-app case, and restarting on it would re-issue every
        // Lookup for a page the reader never left.
        if (
          Option.isSome(elected) && subjectOf(before) === elected.value
        ) {
          yield* SubscriptionRef.update(ref, (reading) => ({
            ...reading,
            address,
            title,
            // A later sighting of the same Subject may know more about how the
            // reader got here, and never less — the same reason `arrival` is
            // not overwritten below. A content script's report carries no
            // redirect chain, so an empty one must not erase the commit's.
            //
            // This holds only while the Reading survives. An MV3 worker torn
            // down and woken by a surface rebuilds it from the tab's current
            // address, and the chain is gone — so a page reached by redirect
            // un-folds until the reader navigates to it again. Left alone on
            // purpose: persisting it would mean writing one reader's navigation
            // to disk to make a suppression stickier, and ADR 0005 wants every
            // degradation here to run toward showing.
            traversed: traversed.length === 0 ? reading.traversed : traversed,
            // A later sighting may know more about how the reader got here —
            // the content script's referrer arrives after the background's own
            // boundary — but it can never know less, so `Elsewhere` never
            // overwrites a Network we already established.
            arrival: reading.arrival._tag === "Elsewhere" ? arrival : reading.arrival
          }))
          // THE title correction path. `onCommitted` fires before `<title>`
          // parses, so the first Reading of nearly every page is sighted under
          // the browser's placeholder title and its Topical Lookups withhold
          // as `no-title`; the real title reaches this branch — a later
          // sighting of the SAME Subject — and `retitle` re-asks exactly those
          // Places. Forked into the board's own scope, like `insist` and for
          // the same reason: the sighting must not wait behind Lookups, and a
          // navigation half a second later must not interrupt them mid-flight
          // and leave a Place stuck at "still looking". `retitle` itself
          return
        }

        yield* release(tabId)

        if (Option.isNone(elected)) {
          // Not a public web page at all — a `chrome://` surface, an internal
          // hostname, an address carrying credentials. There is no Subject to
          // open an Enquiry about, so there is nothing for the reader to
          // override either; a page merely EXCLUDED still mints a Subject and
          // lands as a Withholding per Place, which is overridable and visible.
          yield* SubscriptionRef.set(ref, {
            address,
            traversed,
            title,
            arrival,
            standing: Standing.cases.Excluded.make({
              reason: "excluded",
              because:
                "This is not a public web page, so there is nothing for anyone to have linked to."
            }),
            excludedBecause: null
          })
          return
        }

        const subject = elected.value
        yield* SubscriptionRef.set(ref, {
          address,
          traversed,
          title,
          arrival,
          standing: Standing.cases.Enquiring.make({
            subject,
            knowledge: begin(subject, enquiry.places)
          }),
          // Computed once per settled address rather than per frame: it is a
          // function of the address, and the address is what just changed.
          excludedBecause: yield* groundFor(subject)
        })

        const watch = Effect.scoped(Effect.gen(function*() {
          const knowledge = yield* enquiry.about(subject, title)
          yield* Stream.runForEach(
            SubscriptionRef.changes(knowledge),
            (learned: Knowledge) =>
              SubscriptionRef.update(ref, (reading) =>
                // Guarded: an answer that lands after the reader has navigated
                // away belongs to a Subject this tab is no longer reading, and
                // writing it here would show one page's Discussions under
                // another page's address.
                subjectOf(reading) === subject
                  ? {
                    ...reading,
                    standing: Standing.cases.Enquiring.make({ subject, knowledge: learned })
                  }
                  : reading)
          )
        }))

        watchers.set(tabId, yield* Effect.forkIn(watch, scope))

        // A fresh Reading can rejoin a WARM Enquiry — a back button inside the
        // idle window — whose Topical Places settled as `no-title` in a worker
        // lifetime that never learned the title. This tab may already know it,
      })

      const insist = Effect.fn("Board.insist")(function*(tabId: number) {
        const ref = readings.get(tabId)
        if (ref === undefined) return
        const reading = yield* SubscriptionRef.get(ref)
        const subject = subjectOf(reading)
        if (subject === null) return
        // Forked into the board's own scope, not the caller's: the caller is
        // whichever surface asked, and a popup the reader closes half a second
        // later must not interrupt the Lookups it started. The Enquiry's own
        // updates reach this tab through the watcher that is already running.
        yield* Effect.forkIn(Effect.scoped(enquiry.insist(subject, reading.title)), scope)
      })

      const summarise = Effect.fn("Board.summarise")(function*(tabId: number) {
        const ref = readings.get(tabId)
        if (ref === undefined) return
        const reading = yield* SubscriptionRef.get(ref)
        const subject = subjectOf(reading)
        if (subject === null) return
        // Forked into the board's own scope for the same reason `insist` is: a
        // Digest takes several seconds and the popup that asked for it is often
        // closed before it lands. Its own updates reach this tab through the
        // watcher already running against the Enquiry.
        yield* Effect.forkIn(Effect.scoped(enquiry.summarise(subject)), scope)
      })

      const close = Effect.fn("Board.close")(function*(tabId: number) {
        yield* release(tabId)
        readings.delete(tabId)
      })

      return Board.of({ open, sight, insist, summarise, close })
    })
  )
}
