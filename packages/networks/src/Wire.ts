/**
 * Reading a response without ever letting it lie about what it is.
 *
 * Two rules, both of which exist because a naive reading of a 200 is how a
 * connector manufactures a Silence out of nothing:
 *
 * 1. The status match is TOTAL. No `filterStatusOk`, no thrown status error
 *    that something upstream turns into a generic failure — every status maps
 *    to a named outcome here, and 403 in particular fails fast rather than
 *    being retried, because ADR 0013 makes it the ordinary Reddit answer and
 *    ADR 0001 makes it the ordinary cold-session X answer.
 *
 * 2. A 200 must also be the right KIND of thing. Cloudflare interstitials,
 *    Reddit's "whoa there, pardner!" block page and Safari's captive-portal
 *    replacements all arrive as `text/html` with a success status, and every
 *    one of them parses to zero results. Filed as a Silence they would be
 *    cached as evidence about the world and would close the X gate as a promise
 *    kept. Filed as a Garble they are retried never, cached never, and rendered
 *    as what they are.
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { Declined, Garbled, type Unanswered, refusalForStatus } from "./Source.ts"

const contentType = (response: HttpClientResponse.HttpClientResponse): string =>
  (response.headers["content-type"] ?? "").toLowerCase()

/** The status is not a success. Name the Refusal it implies. */
const refuse = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<never, Unanswered> =>
  Effect.fail(new Declined({ reason: refusalForStatus(response.status) }))

/**
 * Decode a successful JSON body, or say precisely why it was not one.
 *
 * The `content-type` gate runs before the parse rather than relying on
 * `JSON.parse` to throw, because an HTML block page whose first bytes happen to
 * parse is not a hypothetical we want to depend on being impossible.
 */
export const expectJson = <T, E>(schema: Schema.Codec<T, E, never, never>) => {
  const decode = Schema.decodeUnknownEffect(schema)
  return (response: HttpClientResponse.HttpClientResponse): Effect.Effect<T, Unanswered> => {
    if (response.status < 200 || response.status >= 300) return refuse(response)
    const type = contentType(response)
    if (type !== "" && !type.includes("json")) {
      return Effect.fail(
        new Garbled({ detail: `expected JSON, the Network answered 200 with ${type}` })
      )
    }
    return response.text.pipe(
      Effect.mapError(() => new Garbled({ detail: "the body could not be read" })),
      Effect.flatMap((body) =>
        Effect.try({
          try: () => JSON.parse(body) as unknown,
          catch: () => new Garbled({ detail: "the body was not JSON" })
        })
      ),
      Effect.flatMap((json) =>
        decode(json).pipe(
          Effect.mapError((issue) => new Garbled({ detail: `the answer did not decode: ${issue.message}` }))
        )
      )
    )
  }
}

/**
 * Read a successful HTML body.
 *
 * The mirror of {@link expectJson}: a JSON error document served with a 200 is
 * as much a Garble as an HTML interstitial is, and the tier-2 Reddit path is
 * the one place we ask for markup on purpose.
 */
export const expectHtml = (
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<string, Unanswered> => {
  if (response.status < 200 || response.status >= 300) return refuse(response)
  const type = contentType(response)
  if (type !== "" && !type.includes("html")) {
    return Effect.fail(new Garbled({ detail: `expected HTML, the Network answered 200 with ${type}` }))
  }
  return response.text.pipe(
    Effect.mapError(() => new Garbled({ detail: "the body could not be read" }))
  )
}
