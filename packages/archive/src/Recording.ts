/**
 * An `HttpClient` that answers from a function of the URL.
 *
 * Shipped rather than hidden in a test directory for the same two reasons
 * `@parle/networks`' own recording layer is: the panel and the redirect wiring
 * will need to test their behaviour against an Archive that says
 * `NothingArchived`, or `CouldNotAsk`, without touching a nonprofit's servers
 * from CI — and a fake that lives beside the code it fakes is one that gets
 * updated when that code moves.
 *
 * {@link Recording.asked} is the whole point of keying on the URL. "Did it stop
 * after the availability request" is a BEHAVIOUR of this package, not an
 * implementation detail: it is how the request budget in {@link ./Archive.ts}
 * is enforced, and the only way to prove a 429 was not retried.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

/** What a recorded endpoint answers with. */
export interface Exchange {
  readonly status: number
  readonly body: string
  readonly headers?: Record<string, string>
}

export interface Recording {
  readonly layer: Layer.Layer<HttpClient.HttpClient>
  /** Every URL asked for, in order. Live — read it after running. */
  readonly asked: ReadonlyArray<string>
}

export const recording = (answer: (url: string) => Exchange): Recording => {
  const asked: Array<string> = []
  const client = HttpClient.make((request, url) => {
    const address = url.toString()
    asked.push(address)
    const exchange = answer(address)
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(exchange.body, {
          status: exchange.status,
          headers: exchange.headers ?? { "content-type": "application/json" }
        })
      )
    )
  })
  return { layer: Layer.succeed(HttpClient.HttpClient, client), asked }
}

/** A 200 carrying JSON, which is what both endpoints answer with when well. */
export const json = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json;charset=utf-8" }
})

/**
 * A 200 carrying HTML — the WAF interstitial.
 *
 * A named constructor because this is the shape the `Garbled` case exists for,
 * and a test that spells it out inline invites someone to "simplify" it into a
 * JSON body and quietly delete the coverage.
 */
export const interstitial = (body = "<html><body>are you a robot?</body></html>"): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "text/html; charset=utf-8" }
})
