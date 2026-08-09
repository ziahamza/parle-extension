/**
 * Which failures are worth asking again about, and which are answers.
 *
 * The whole value of this module is what it leaves OUT. `403` is not here, and
 * `401` is not here, because ADR 0013 makes Reddit's tier-1 403 and X's auth
 * 403 the ordinary path rather than an outage: they are a settled fact about
 * our standing with that Network, and asking again cannot change it within one
 * Enquiry. Retrying them spends the reader's own rate budget — on Reddit it is
 * shared with their own browsing, on X it is their own authenticated account —
 * to re-learn something we already know, and it delays the rendered state the
 * panel owes them. So a 403 fails fast, lands on a Refusal, and renders.
 *
 * `404` is likewise absent. A page that is not there will not be there in 400
 * milliseconds, and treating it as transient turns a fast honest Refusal into a
 * slow one.
 *
 * The schedule is exponential, jittered and capped in BOTH directions: capped
 * per-delay so one 503 cannot park an Enquiry for a minute, and capped in
 * attempts so a Network that is comprehensively down costs a bounded amount of
 * the reader's battery and a bounded amount of their patience.
 */
import * as Duration from "effect/Duration"
import * as Schedule from "effect/Schedule"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type { Reception } from "./Reception.ts"

/**
 * The transient status set, written out rather than derived from a class.
 *
 * `5xx` is not blanket-transient and `4xx` is not blanket-permanent: `501 Not
 * Implemented` will never succeed on retry, and `408` and `429` are 4xx that
 * will. Enumerating is the only way to say that, and it makes the 403 decision
 * visible as a decision instead of a consequence of arithmetic on status codes.
 */
export const transientStatuses: ReadonlySet<number> = new Set([
  408, // the Network gave up waiting for our request
  425, // too early — replay is exactly what is wanted
  429, // over budget, and the pacing will have widened by the next attempt
  500,
  502,
  503,
  504
])

/** True for statuses where asking again can plausibly give a different answer. */
export const isTransientStatus = (status: number): boolean => transientStatuses.has(status)

/**
 * True for Receptions worth asking about again.
 *
 * A Garble is never transient: an interstitial served as success and a truncated
 * payload are answers, and the domain says a Garble is never retried. A Silence
 * is not transient either — it is the one outcome that is evidence about the
 * world.
 */
export const isTransientReception = <A>(reception: Reception<A>): boolean =>
  reception._tag === "Refusal" &&
  (reception.reason === "rate-limited" ||
    reception.reason === "timed-out" ||
    reception.reason === "offline")

/** How hard to try, and how patiently. */
export interface Persistence {
  /** The first delay. Every subsequent one doubles from here. */
  readonly firstDelay: Duration.Input
  /** No single delay exceeds this, however many attempts have failed. */
  readonly longestDelay: Duration.Input
  /** How many RETRIES follow the first attempt. */
  readonly retries: number
}

/**
 * Deliberately small. A reader is looking at the page now; a Lookup that is
 * still grinding after a couple of seconds has already lost to the panel
 * rendering a Refusal, which is a legitimate outcome rather than a failure.
 */
export const defaultPersistence: Persistence = {
  firstDelay: Duration.millis(250),
  longestDelay: Duration.seconds(4),
  retries: 2
}

/**
 * Exponential, jittered, then capped — in that order.
 *
 * Jitter multiplies by up to 1.2, so capping after jittering is what actually
 * honours `longestDelay`. Jitter is not decoration: an Enquiry fires several
 * Networks at once and a Network that is down fails all of them at the same
 * instant, so an unjittered schedule reconverges every attempt into one
 * synchronised burst.
 */
export const transientSchedule = (
  persistence: Persistence = defaultPersistence
): Schedule.Schedule<Duration.Duration> =>
  Schedule.min([
    Schedule.exponential(persistence.firstDelay).pipe(Schedule.jittered),
    Schedule.spaced(persistence.longestDelay)
  ]).pipe(Schedule.upTo({ times: persistence.retries }))

/**
 * Retry the transient half of the world, and nothing else.
 *
 * Applied ABOVE the pacing transformer, so every retry re-enters the token
 * bucket rather than stampeding a Network that just told us to slow down.
 */
export const persisting = (persistence: Persistence = defaultPersistence) =>
<E, R>(self: HttpClient.HttpClient.With<E, R>): HttpClient.HttpClient.With<E, R> =>
  HttpClient.retryTransient(self, {
    retryOn: "errors-and-responses",
    schedule: transientSchedule(persistence),
    times: persistence.retries
  })
