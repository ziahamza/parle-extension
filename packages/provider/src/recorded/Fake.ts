/**
 * A stand-in HttpClient that answers from a recording and keeps what it was
 * asked, so tests can assert on the request as well as on the answer.
 *
 * Both HTTP Providers are mostly request-construction — two headers and a body
 * shape that a real endpoint either accepts or silently bills to nobody — so
 * the request is as much of the contract as the response is.
 */
import * as Effect from "effect/Effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

export interface Recording {
  readonly client: HttpClient.HttpClient
  /** Every request the client was given, in order. */
  readonly asked: Array<HttpClientRequest.HttpClientRequest>
}

/** A client that answers every request with `answer`. */
export const answering = (
  answer: (request: HttpClientRequest.HttpClientRequest) => Response
): Recording => {
  const asked: Array<HttpClientRequest.HttpClientRequest> = []
  const client = HttpClient.make((request) => {
    asked.push(request)
    return Effect.succeed(HttpClientResponse.fromWeb(request, answer(request)))
  })
  return { client, asked }
}

/** A client that answers with one body and status, whatever it is asked. */
export const saying = (body: BodyInit, status = 200): Recording =>
  answering(() =>
    new Response(body, {
      status,
      headers: { "content-type": "text/event-stream" }
    })
  )

/**
 * A body that delivers some bytes and then dies.
 *
 * This is what a Provider lost mid-Digest actually looks like on the wire: not
 * a clean end, a reset connection with a half-written event still in flight.
 */
export const cutOff = (prefix: string): ReadableStream<Uint8Array> => {
  // The bytes must be DELIVERED before the failure, not merely enqueued:
  // erroring a controller resets its queue, which would model a connection that
  // died before sending anything — a different, easier case.
  let delivered = false
  return new ReadableStream({
    pull(controller) {
      if (delivered) {
        controller.error(new Error("connection reset by peer"))
        return
      }
      delivered = true
      controller.enqueue(new TextEncoder().encode(prefix))
    }
  })
}

/** The JSON body a recorded request carried. */
export const bodyOf = (request: HttpClientRequest.HttpClientRequest): unknown => {
  const body = request.body
  if (body._tag !== "Uint8Array") return undefined
  return JSON.parse(new TextDecoder().decode(body.body)) as unknown
}
