/**
 * The classifier is where "nothing found" acquires a cause, so these tests are
 * about the two mistakes that are invisible in production:
 *
 *   - calling a Garble a Silence, which caches a lie and permanently closes the
 *     X gate on a page that is in fact discussed;
 *   - calling a Refusal a Silence, same consequence, from the other direction.
 *
 * Both are silent when wrong, so nothing here asserts on a happy path alone.
 */
import { describe, expect, it } from "vitest"
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import type { Place } from "@parle/domain/Coverage"
import { Mention } from "@parle/domain/Mention"
import * as Reception from "./Reception.ts"

const request = HttpClientRequest.get("https://hn.algolia.com/api/v1/search")

const answered = (
  status: number,
  body?: string,
  headers: Record<string, string> = {}
): HttpClientResponse.HttpClientResponse =>
  HttpClientResponse.fromWeb(
    request,
    // 204/304 may not carry a body per the Fetch spec.
    new Response(status === 204 || status === 304 ? null : body ?? "", { status, headers })
  )

const hn: Place = { _tag: "Network", network: "hackernews", question: "linked" }

const linkedMention = Mention.cases.Linked.make({
  subject: "https://example.com/a" as never,
  discussion: { network: "hackernews", nativeId: "41293011" as never } as never,
  viaAlias: "https://example.com/a"
})

describe("the status classifier", () => {
  it("does not turn a 403 into a Silence", () => {
    // ADR 0013's ordinary Reddit tier-1 outcome. Filed as a Silence it would be
    // cached, and would then close the X gate for the whole TTL on a page that
    // may well be discussed everywhere.
    const reception = Reception.receive(answered(403, "{}"))
    expect(reception._tag).toBe("Refusal")
    if (reception._tag !== "Refusal") return
    expect(reception.reason).toBe("forbidden")
    expect(reception.status).toStrictEqual(Option.some(403))
  })

  it("distinguishes not-signed-in from forbidden", () => {
    const unauthorised = Reception.receive(answered(401))
    const forbidden = Reception.receive(answered(403))
    expect(unauthorised._tag === "Refusal" && unauthorised.reason).toBe("not-signed-in")
    expect(forbidden._tag === "Refusal" && forbidden.reason).toBe("forbidden")
  })

  it("reads how long a rate-limited Network asked us to wait", () => {
    const reception = Reception.receive(answered(429, "", { "retry-after": "30" }))
    expect(reception._tag).toBe("Refusal")
    if (reception._tag !== "Refusal") return
    expect(reception.reason).toBe("rate-limited")
    expect(reception.waitFor).toStrictEqual(Option.some(Duration.seconds(30)))
  })

  it("ignores an HTTP-date retry-after rather than guessing", () => {
    const reception = Reception.receive(answered(429, "", { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }))
    expect(reception._tag === "Refusal" && Option.isNone(reception.waitFor)).toBe(true)
  })

  it("treats 204 as a Silence and 3xx as a Garble", () => {
    expect(Reception.receive(answered(204))._tag).toBe("Silence")
    expect(Reception.receive(answered(302))._tag).toBe("Garble")
  })

  it("never lands an unrecognised status on a Silence", () => {
    for (const status of [418, 451, 501, 599]) {
      expect(Reception.receive(answered(status, "{}"))._tag).toBe("Refusal")
    }
  })
})

describe("a 200 is not an answer", () => {
  const understand = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.runPromise(Reception.understandJson(response))

  it("classifies an interstitial served as 200 as a Garble, NOT a Silence", async () => {
    // A Cloudflare challenge arrives as text/html with a 200. Filed as a Silence
    // it is cached and closes the X gate; filed as a Refusal it would be
    // retried, spending the reader's budget on a page that will keep serving it.
    const reception = await understand(
      answered(200, "<!DOCTYPE html><html><head><title>Just a moment...</title>", {
        "content-type": "text/html"
      })
    )
    expect(reception._tag).toBe("Garble")
  })

  it("classifies a truncated payload as a Garble", async () => {
    // The Provider-dies-mid-stream shape, at the transport layer: enough bytes
    // to look like an answer, not enough to be one.
    const reception = await understand(answered(200, `{"hits":[{"objectID":"41293`))
    expect(reception._tag).toBe("Garble")
  })

  it("classifies an empty body as a Garble", async () => {
    expect((await understand(answered(200, "   ")))._tag).toBe("Garble")
  })

  it("keeps a well-formed empty payload as Received — the parser decides", async () => {
    // `{"hits":[]}` really is an answer with nothing in it, and only the
    // connector knows that. The classifier must not pre-empt it.
    const reception = await understand(answered(200, `{"hits":[],"nbHits":0}`))
    expect(reception._tag).toBe("Received")
  })

  it("does not read the body of a 403 at all", async () => {
    // Reddit serves an HTML block page with its 403. Reading it first would
    // downgrade a Refusal we can render into a Garble we cannot explain.
    const reception = await understand(answered(403, "<html>blocked</html>"))
    expect(reception._tag).toBe("Refusal")
  })
})

describe("the transport classifier", () => {
  const asError = (reason: HttpClientError.HttpClientErrorReason) =>
    Reception.receiveFault(new HttpClientError.HttpClientError({ reason }))

  it("tells a timeout apart from a dead network", () => {
    const timedOut = asError(
      new HttpClientError.TransportError({ request, cause: new Cause.TimeoutError("too slow") })
    )
    const offline = asError(new HttpClientError.TransportError({ request, cause: new TypeError("Failed to fetch") }))
    expect(timedOut._tag === "Refusal" && timedOut.reason).toBe("timed-out")
    expect(offline._tag === "Refusal" && offline.reason).toBe("offline")
  })

  it("re-classifies a StatusCodeError through the status classifier", () => {
    const reception = asError(
      new HttpClientError.StatusCodeError({ request, response: answered(403) })
    )
    expect(reception._tag === "Refusal" && reception.reason).toBe("forbidden")
  })

  it("calls an interruption a Refusal, not a Silence", () => {
    // MV3 kills the worker mid-flight. "We will never find out" is a fact about
    // the attempt; filing it as a Silence would cache an answer we never heard.
    const reception = Reception.receiveCause(Cause.interrupt())
    expect(reception._tag === "Refusal" && reception.reason).toBe("interrupted")
  })
})

describe("the door into the domain", () => {
  it("turns an answer carrying no Mentions into a Silence", () => {
    // NOT `Answered []`, which renders as a panel that found something and shows
    // nothing, and lets callers avoid ever naming the empty case.
    const consultation = Reception.asConsultation(hn, Reception.received([]))
    expect(consultation._tag).toBe("Silence")
  })

  it("keeps an answer carrying Mentions as Answered", () => {
    const consultation = Reception.asConsultation(hn, Reception.received([linkedMention]))
    expect(consultation._tag).toBe("Answered")
  })

  it("carries a Garble's detail through, so the panel can say what happened", () => {
    const consultation = Reception.asConsultation(hn, Reception.garble("an interstitial as success"))
    expect(consultation).toMatchObject({ _tag: "Garble", detail: "an interstitial as success" })
  })

  it("carries a Refusal's reason through unchanged", () => {
    const consultation = Reception.asConsultation(
      hn,
      Reception.refusal("rate-limited", "over budget")
    )
    expect(consultation).toMatchObject({ _tag: "Refusal", reason: "rate-limited" })
  })
})
