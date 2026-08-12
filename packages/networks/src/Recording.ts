/**
 * Recorded exchanges, so both Reddit tiers are testable without the network.
 *
 * This exists because the interesting half of this package is unreachable from
 * a build machine. `www.reddit.com/api/info.json` and `old.reddit.com/search`
 * both answer 403 with a block page from any datacenter IP — verified from this
 * sandbox on 2026-08-08 — which is precisely the condition ADR 0013's fallback
 * chain was written for. A test that reached for the wire would either be
 * skipped in CI or would assert the 403 path forever and never once exercise
 * the parse.
 *
 * It is shipped rather than hidden under a test directory because the same
 * fake is what any downstream package needs to test its own behaviour against a
 * connector, and because a fake that lives beside the code it fakes is one that
 * gets updated when the code moves.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { Discussion, DiscussionSink } from "./Discussion.ts"
import type { Observation, ObservationSink } from "./Observation.ts"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

/** What a recorded endpoint answers with. */
export interface Exchange {
  readonly status: number
  readonly body: string
  readonly headers?: Record<string, string>
}

export interface Recording {
  /** An `HttpClient` layer answering from {@link answer}. */
  readonly layer: Layer.Layer<HttpClient.HttpClient>
  /** Every URL asked for, in order. Live — read it after running. */
  readonly asked: ReadonlyArray<string>
}

/**
 * An HttpClient that answers from a function of the URL.
 *
 * The URL is the full resolved address including query, so a test can assert
 * on WHICH tier was reached — which is the whole point for Reddit, where "did
 * it stop asking tier 1" is a behaviour and not an implementation detail.
 */
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

export interface SinkRecording {
  readonly sink: ObservationSink
  /** Every Observation handed over, in order. Live. */
  readonly seen: ReadonlyArray<Observation>
}

/** An ObservationSink that keeps what it is given. */
export const recordingSink = (): SinkRecording => {
  const seen: Array<Observation> = []
  return {
    sink: {
      observe: (observations) =>
        Effect.sync(() => {
          seen.push(...observations)
        })
    },
    seen
  }
}

export interface RowRecording {
  readonly sink: DiscussionSink
  /** Every Discussion handed over, in order. Live. */
  readonly noted: ReadonlyArray<Discussion>
}

/** A DiscussionSink that keeps what it is given. */
export const recordingRows = (): RowRecording => {
  const noted: Array<Discussion> = []
  return {
    sink: {
      note: (discussions) =>
        Effect.sync(() => {
          noted.push(...discussions)
        })
    },
    noted
  }
}
