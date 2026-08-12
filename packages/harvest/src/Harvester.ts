/**
 * The daemon that turns pages the reader was already on into a Local Discussion
 * Cache.
 *
 * **The daemon is owned by the layer, not by any caller.** The `PubSub` is
 * built during `Layer.effect`, subscribed to before the layer is available to
 * anybody, and drained by a fiber on `Effect.forkScoped`. Nothing outside this
 * file can start it, stop it, or forget to. A design where a caller forks the
 * consumer is one where a content script's message handler owns a background
 * pipeline, and MV3 will tear that handler down mid-page.
 *
 * **Nothing is ever dropped.** The `PubSub` is `bounded` (which back-pressures
 * publishers), the buffer's strategy is `suspend`, and the throttle's is
 * `shape`. Sliding and dropping are not available options here and are not
 * merely discouraged: measured on this pipeline they delivered 2 of 8 offered
 * items, with no event, no failure and no log line — a Discussion silently
 * absent from the reader's cache forever, which is exactly the invisible false
 * negative every decision in this project has chosen against. The cost of the
 * choice is that `offer` may take a while to return under pressure. That is the
 * right trade: harvesting runs behind the reader, and nothing renders from it
 * synchronously.
 *
 * Back-pressure is only half of it. The other half is that the single fiber
 * draining the hand-off must not be able to end. `Stream.runDrain` finishing
 * early is a drop with no bound at all — not one item, but every item from that
 * moment on, followed by an `offer` that blocks its caller forever once the
 * hand-off fills. `settle` therefore catches its own Cause and logs it: a
 * sighting lost loudly, rather than a pipeline lost quietly.
 *
 * **The subscription is taken during layer build, not inside the forked fiber.**
 * A `PubSub` delivers only to subscribers that already exist, so subscribing
 * inside the daemon would open a window — between the layer being ready and the
 * fiber being scheduled — in which every offered page vanished. The window is
 * small, which is worse than large: it would close on a fast machine and open
 * on a loaded one.
 *
 * **What lands when.** A Discussion's numbers and title need no resolution, so
 * they are recorded by `offer` itself, immediately. Only the Mention waits,
 * because only the Mention needs the destination — and ADR 0012 is unambiguous
 * that the destination, not the tracking URL, is the key.
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { Mention } from "@parle/domain/Mention"
import { discussionKey } from "@parle/domain/Network"
import type { SubjectUrl } from "@parle/domain/Subject"
import { Observation } from "@parle/memory/Observation"
import { Recollection } from "@parle/memory/Recollection"
import { LinkResolver } from "./LinkResolver.ts"
import { BreakageSink, DiscussionSink, type NetworkPage, type Sighting } from "./Page.ts"
import { read } from "./Pages.ts"
import { type Resolution, subjectOf } from "./Resolution.ts"

/**
 * How fast harvesting is willing to work through what it has seen.
 *
 * Politeness, not throughput. The only requests this pipeline makes are
 * shortlink resolutions, and ADR 0012 caps those by budget in
 * {@link ./LinkResolver.ts}; the throttle here is the second, independent
 * bound — it shapes the *rate*, so that a reader who opens six tabs of Hacker
 * News does not produce a burst that looks like a crawler even while staying
 * inside the hourly budget.
 */
export interface Pace {
  /** How many sightings may sit in the hand-off before publishers wait. */
  readonly capacity: number
  /** How many may sit between the hand-off and the throttle. */
  readonly buffer: number
  /** Sightings per {@link window}. */
  readonly perWindow: number
  readonly window: Duration.Duration
  /** How large a burst is forgiven — a page arriving all at once. */
  readonly burst: number
  /** How many resolutions may be in flight together. */
  readonly concurrency: number
}

export const defaultPace: Pace = {
  capacity: 1024,
  buffer: 256,
  perWindow: 8,
  window: Duration.seconds(1),
  burst: 16,
  concurrency: 4
}

/** One sighting awaiting resolution, and the ticket that identifies it. */
interface Job {
  readonly ticket: number
  readonly sighting: Sighting
}

export class Harvester extends Context.Service<Harvester, {
  /**
   * Record everything one Network page implies.
   *
   * Titles and numbers commit before this returns. Mentions are queued, because
   * each one needs its link's destination first.
   *
   * Under pressure this waits rather than discarding, which is the whole point
   * of the pipeline it feeds.
   */
  readonly offer: (page: NetworkPage) => Effect.Effect<void>
  /**
   * "I may be the destination of a pending resolution."
   *
   * The demand channel. A politely throttled FIFO queue is the right shape for
   * work nobody is waiting for, and the wrong shape the moment the reader's
   * thumb beats it to the page they just tapped: the Discussion they arrived
   * from is sitting in the queue, unresolved, behind thirty links they will
   * never open. This resolves what is waiting *now*, against a separate
   * allowance, stopping as soon as one of them turns out to be the page they
   * are standing on.
   *
   * The reader's own navigation is free evidence and is not spent here — the
   * browser has already been to the destination. Feed it back with
   * `LinkResolver.learn`, which back-fills the same cache this drains.
   */
  readonly prioritise: (subject: SubjectUrl) => Effect.Effect<void>
  /** How many sightings are still waiting on a destination. Observability, and a test hook. */
  readonly waiting: Effect.Effect<number>
}>()("parle/harvest/Harvester") {
  static readonly layerWith = (pace: Pace): Layer.Layer<Harvester, never, LinkResolver | Recollection> =>
    Layer.effect(
      Harvester,
      Effect.gen(function*() {
        const resolver = yield* LinkResolver
        const recollection = yield* Recollection
        const discussions = yield* DiscussionSink
        const breakage = yield* BreakageSink

        // Bounded, therefore back-pressuring. `PubSub.dropping` and
        // `PubSub.sliding` are the two ways to lose a Discussion without
        // anybody finding out.
        const queue = yield* PubSub.bounded<Job>({ capacity: pace.capacity })
        yield* Effect.addFinalizer(() => PubSub.shutdown(queue))
        const subscription = yield* PubSub.subscribe(queue)

        const pending = yield* Ref.make<ReadonlyMap<number, Sighting>>(new Map())
        const tickets = yield* Ref.make(0)

        const remember = Effect.fn("Harvester.remember")(function*(
          sighting: Sighting,
          resolution: Resolution
        ) {
          const subject = subjectOf(resolution)
          // `NotASubject`: the href was a `mailto:`, a fragment or an internal
          // hostname. There is no page for a Mention to be about, so there is
          // nothing lost by not writing one.
          if (Option.isNone(subject)) return
          const mention = sighting.tier === "Linked"
            // `viaAlias` is the raw href — the tracking URL as the page carried
            // it. That is the evidence; the destination is the key. Recording
            // both is what makes a Mention repairable when a shortlink that
            // refused today resolves tomorrow.
            ? Mention.cases.Linked.make({
              subject: subject.value,
              discussion: sighting.discussion.id,
              viaAlias: sighting.link
            })
            : Mention.cases.Passing.make(
              sighting.inComment === undefined
                ? { subject: subject.value, discussion: sighting.discussion.id }
                : {
                  subject: subject.value,
                  discussion: sighting.discussion.id,
                  inComment: sighting.inComment
                }
            )
          yield* recollection.remember([mention])
        })

        const release = (tickets: ReadonlyArray<number>) =>
          Ref.update(pending, (held) => {
            const next = new Map(held)
            for (const ticket of tickets) next.delete(ticket)
            return next
          })

        const resolveAndRemember = Effect.fn("Harvester.settle")(function*(job: Job) {
          const resolution = yield* resolver.destinationOf(job.sighting.link)
          yield* remember(job.sighting, resolution)
        })

        /**
         * Settle one sighting, and survive it.
         *
         * **The daemon may not die.** Everything `resolveAndRemember` calls is
         * declared total, so nothing here is expected to raise — but "expected"
         * is not a guarantee, and the consequence of being wrong is the worst
         * failure this package has. `Stream.runDrain` would end, the
         * subscription would stop draining, every later `offer` would fill the
         * hand-off and then block its caller forever, and not one further
         * Discussion would reach the Local Discussion Cache — with no error, no
         * failed request and no log line, because the fiber that died was
         * forked. That is the invisible false negative this whole file is built
         * against, arriving through the machinery built to prevent it. One
         * sighting lost loudly is strictly better.
         */
        const settle = (job: Job) =>
          Effect.gen(function*() {
            // The demand channel may already have settled this exact sighting
            // and taken its ticket. Doing it again is not harmful — Mentions
            // are idempotent — but it is work, and skipping it is what makes
            // `prioritise` a shortcut rather than an extra lap.
            if (!(yield* Ref.get(pending)).has(job.ticket)) return
            yield* resolveAndRemember(job)
          }).pipe(
            // Released whatever happened, so a single failure cannot leave
            // `waiting` permanently above zero.
            Effect.ensuring(release([job.ticket])),
            Effect.catchCause((cause) =>
              Effect.logError("harvest could not settle a sighting").pipe(Effect.annotateLogs({ cause }))
            )
          )

        yield* Stream.fromSubscription(subscription).pipe(
          Stream.buffer({ capacity: pace.buffer, strategy: "suspend" }),
          Stream.throttle({
            cost: (arriving) => arriving.length,
            units: pace.perWindow,
            duration: pace.window,
            burst: pace.burst,
            strategy: "shape"
          }),
          Stream.mapEffect(settle, { concurrency: pace.concurrency }),
          Stream.runDrain,
          Effect.forkScoped
        )

        const offer = Effect.fn("Harvester.offer")(function*(page: NetworkPage) {
          const reading = read(page)
          if (reading.legibility._tag === "Illegible") {
            yield* breakage.broke({
              network: page.network,
              page: page.url,
              expected: reading.legibility.expected
            })
          }
          if (reading.sightings.length === 0) return

          // One Discussion may carry many links — a comment page is mostly that
          // — and its numbers are one reading, not one per link.
          const perDiscussion = new Map<string, Sighting>()
          for (const sighting of reading.sightings) {
            const key = discussionKey(sighting.discussion.id)
            if (!perDiscussion.has(key)) perDiscussion.set(key, sighting)
          }
          const distinct = [...perDiscussion.values()]

          const receivedAt = yield* Clock.currentTimeMillis
          yield* recollection.observe(distinct.map((sighting) => {
            const listed = {
              discussion: sighting.discussion.id,
              // Everything here was on a page the reader was looking at, so
              // "still listed" is the only honest value. Omission is a
              // judgement for a later Observation to license, not this one.
              stillListed: true as const,
              receivedAt
            }
            const score = sighting.numbers.score
            const comments = sighting.numbers.comments
            if (score !== null && comments !== null) {
              return Observation.make({ ...listed, score, comments })
            }
            if (score !== null) {
              return Observation.make({ ...listed, score })
            }
            if (comments !== null) {
              return Observation.make({ ...listed, comments })
            }
            return Observation.make(listed)
          }))
          yield* discussions.note(distinct.map((sighting) => sighting.discussion))

          const first = yield* Ref.getAndUpdate(tickets, (issued) => issued + reading.sightings.length)
          const jobs = reading.sightings.map((sighting, index) => ({ ticket: first + index, sighting }))
          yield* Ref.update(pending, (held) => {
            const next = new Map(held)
            for (const job of jobs) next.set(job.ticket, job.sighting)
            return next
          })
          // Suspends when the hand-off is full. That wait is the guarantee.
          yield* PubSub.publishAll(queue, jobs)
        })

        const prioritise = Effect.fn("Harvester.prioritise")(function*(subject: SubjectUrl) {
          const waitingNow = [...(yield* Ref.get(pending)).entries()]
          for (let at = 0; at < waitingNow.length; at += pace.concurrency) {
            const slice = waitingNow.slice(at, at + pace.concurrency)
            const resolutions = yield* resolver.urgentlyOf(slice.map(([, sighting]) => sighting.link))
            let arrived = false
            const done: Array<number> = []
            for (let index = 0; index < slice.length; index++) {
              const held = slice[index]
              const resolution = resolutions[index]
              if (held === undefined || resolution === undefined) continue
              const [ticket, sighting] = held
              yield* remember(sighting, resolution)
              // The job is finished. Leaving it in `pending` left `waiting`
              // permanently above zero — so it never reads as caught up, and
              // every later `prioritise` re-resolves work already done —
              // while the throttled consumer settled the very same sighting a
              // second time behind it.
              done.push(ticket)
              const landed = subjectOf(resolution)
              if (Option.isSome(landed) && landed.value === subject) arrived = true
            }
            yield* release(done)
            // The reader's page has been found and written. The rest of the
            // queue is not urgent and the throttled consumer will reach it —
            // spending the demand allowance on it would defeat having one.
            if (arrived) return
          }
        })

        const waiting = Effect.map(Ref.get(pending), (held) => held.size)

        return Harvester.of({ offer, prioritise, waiting })
      })
    )

  static readonly layer: Layer.Layer<Harvester, never, LinkResolver | Recollection> = Harvester.layerWith(defaultPace)
}
