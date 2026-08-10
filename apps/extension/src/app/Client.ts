/**
 * The one HTTP client every connector sits on, and the buckets it spends from.
 *
 * `@parle/net` supplies the parts — a fetch client with a timeout, a token
 * bucket, and the composition order that makes each retry take its own token.
 * What it deliberately does NOT supply is which bucket a given request spends
 * from: that is a statement about which Network is being asked what, and it
 * belongs to whoever wired the Networks up. This file is that decision.
 *
 * The keys separate each Network's two Questions. They are physically different
 * requests against different endpoints with independent failure profiles, and
 * the whole reason `linked` and `topical` are separate methods is that one may
 * be rate-limited while the other is fine. Sharing a bucket would let a
 * title search exhaust the budget for the address search that produces the
 * strong tier — the only tier that discharges ADR 0001's disclosure argument.
 *
 * Reddit is paced harder than Hacker News, and not out of caution. Algolia is
 * keyless, CORS-open and answers to anyone. Reddit's budget is the READER'S,
 * shared with whatever they are doing on Reddit in another tab, so spending it
 * is spending something that was not ours; ADR 0013 allows one request per page
 * view and this is where that is enforced rather than asserted.
 *
 * Retrying is left OFF here (`retries: 0`) because each connector already
 * retries the transient half of the world for itself. Two retry layers multiply
 * — three attempts inside three attempts is nine requests for one Lookup — and
 * the one worth keeping is the connector's, since it is the one that knows a
 * 403 from Reddit is an ordinary answer rather than a transient failure.
 */
import * as Duration from "effect/Duration"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Client from "@parle/net/Client"
import { Pace } from "@parle/net/Pace"
import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as UrlParams from "effect/unstable/http/UrlParams"

/**
 * Which bucket a request spends from.
 *
 * Derived from the request rather than passed in, because the connectors are
 * shared code that must not have to know this app's pacing scheme. An
 * unrecognised host gets its own bucket rather than a free pass — a connector
 * added later should be paced by default and named here on purpose.
 */
export const keyOf = (request: HttpClientRequest.HttpClientRequest): string => {
  const address = request.url
  // Reading a Discussion's comments is neither Question. It happens only when
  // the reader asks for a Digest, it is one request per Discussion rather than
  // one per page, and the bodies are large — so it gets its own bucket rather
  // than spending an allowance sized for search. Sharing one would let a single
  // Digest exhaust the budget for the address search that produces the strong
  // tier, on every page the reader opened next.
  if (address.includes("hn.algolia.com/api/v1/items")) return "hackernews:comments"
  if (/reddit\.com\/comments\//.test(address)) return "reddit:comments"
  if (address.includes("hn.algolia.com")) return "hackernews:linked"
  if (address.includes("reddit.com")) return "reddit:linked"
  return "other"
}

/**
 * The token buckets, one per Network.
 *
 * Hacker News' `linked` burst is six because one address Lookup asks about up
 * to four Aliases at once — a burst smaller than the fan-out turns the very
 * first Lookup on a page into a queue, which the reader experiences as the
 * extension being slow rather than as being polite.
 */
export const pacing = Pace.layerWith({
  byKey: {
    "hackernews:linked": { perSecond: 3, burst: 6, blindHold: Duration.seconds(60) },
    // One per page view, and a long hold when Reddit says to stop: the reader
    // is the one who pays for getting this wrong.
    "reddit:linked": { perSecond: 0.5, burst: 2, blindHold: Duration.seconds(120) },
    // A Digest reads up to six Discussions at once and only when the reader
    // asked, so the burst is the whole of one Digest and the steady rate is
    // slow enough that clicking repeatedly cannot turn into a crawl of Hacker
    // News. Reddit stays the tighter of the two for the same reason it is
    // tighter everywhere: the budget being spent is the reader's own.
    "hackernews:comments": { perSecond: 2, burst: 6, blindHold: Duration.seconds(60) },
    "reddit:comments": { perSecond: 0.5, burst: 3, blindHold: Duration.seconds(120) }
  }
})

/**
 * The client the connectors are given: paced, timed out, not retried.
 *
 * `Client.forNetwork` discharges `Pace` into the returned client, so a
 * connector's requirement channel stays empty and nothing downstream can reach
 * the bucket to route around it.
 */
export const layer: Layer.Layer<HttpClient.HttpClient> = Layer.effect(
  HttpClient.HttpClient,
  Client.forNetwork({
    keyOf,
    persistence: { firstDelay: "250 millis", longestDelay: "4 seconds", retries: 0 }
  })
).pipe(Layer.provide(Layer.mergeAll(Client.layer, pacing)))
