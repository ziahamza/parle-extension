/**
 * Recorded exchanges, so this package is testable without the network.
 *
 * The same fake as `packages/networks/src/Recording.ts`, restated here for the
 * dependency reason in {@link ./Address.ts}, and shipped rather than hidden
 * under a test directory for the same reason it is there: the fake a
 * downstream package needs in order to test its own behaviour against a
 * reference source is the same one this package tests itself with, and a fake
 * that lives beside the code it fakes is one that gets updated when the code
 * moves.
 *
 * The URL recorded is the full resolved address including the query string, so
 * a test can assert on WHICH request was issued — which is the whole point
 * here, where "did it spend the second request" is a behaviour and not an
 * implementation detail.
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
  /** An `HttpClient` layer answering from the supplied function. */
  readonly layer: Layer.Layer<HttpClient.HttpClient>
  /** Every URL asked for, in order. Live — read it after running. */
  readonly asked: ReadonlyArray<string>
}

/** An HttpClient that answers from a function of the URL. */
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
