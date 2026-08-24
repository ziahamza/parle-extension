/**
 * Reading a response without ever letting it lie about what it is.
 *
 * The same two rules as `packages/networks/src/Wire.ts`, restated here for the
 * same dependency reason as {@link ./Address.ts}, and load-bearing for the same
 * reason: a naive reading of a 200 is how a source manufactures an `Uncited`
 * out of nothing, and `Uncited` is the one outcome that gets cached.
 *
 * 1. The status match is TOTAL. Every status maps to a named outcome here.
 *    403 and 429 fail fast into a `Refused` rather than being softened —
 *    Wikimedia rate-limits anonymous API traffic by IP, so a reader behind a
 *    busy NAT is the ordinary case for both, not an edge case.
 *
 * 2. A 200 must also be the right KIND of thing. Captive portals, corporate
 *    filters and CDN interstitials all arrive as `text/html` with a success
 *    status and parse to zero results. Filed as an `Uncited` they are cached
 *    as evidence about Wikipedia. Filed as a `Garbled` they are retried never
 *    and cached never.
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { RefusalReason } from "@parle/domain/Coverage"
import type * as HttpClientError from "effect/unstable/http/HttpClientError"

/**
 * The reference source answered and the answer was not usable.
 *
 * Separate from a transport failure because the two have opposite handling: a
 * transport failure is worth retrying and a Garble never is, and neither may
 * ever be cached.
 */
export class Unusable extends Schema.TaggedError<Unusable>()("Unusable", {
  detail: Schema.String
}) {}

/** The reference source would not answer, for a reason we already know how to name. */
export class Refused extends Schema.TaggedError<Refused>()("Refused", {
  reason: RefusalReason
}) {}

/**
 * Everything this package's internals are allowed to fail with.
 *
 * Closed so the classification into a `BacklinkAnswer` is total: there is no
 * path from the wire to a caller that does not pass through one of the four
 * cases.
 */
export type Unanswered = Unusable | Refused | HttpClientError.HttpClientError

/**
 * The Refusal reason for an HTTP status.
 *
 * Total, and deliberately not clever. `forbidden` carries the residue:
 * `RefusalReason` is closed and lives in `@parle/domain`, so a 502 has nowhere
 * better to go, and "the reference source would not answer us" is the honest
 * reading either way.
 */
export const refusalForStatus = (status: number): RefusalReason => {
  if (status === 401) return "not-signed-in"
  if (status === 408 || status === 504) return "timed-out"
  if (status === 429) return "rate-limited"
  return "forbidden"
}

const contentType = (response: HttpClientResponse.HttpClientResponse): string =>
  (response.headers["content-type"] ?? "").toLowerCase()

/**
 * Decode a successful JSON body, or say precisely why it was not one.
 *
 * The `content-type` gate runs before the parse rather than relying on
 * `JSON.parse` to throw, because an HTML block page whose first bytes happen to
 * parse is not a hypothetical worth depending on being impossible.
 */
export const expectJson = <T, E>(schema: Schema.Codec<T, E, never, never>) => {
  const decode = Schema.decodeUnknownEffect(schema)
  return (response: HttpClientResponse.HttpClientResponse): Effect.Effect<T, Unanswered> => {
    if (response.status < 200 || response.status >= 300) {
      return Effect.fail(new Refused({ reason: refusalForStatus(response.status) }))
    }
    const type = contentType(response)
    if (type !== "" && !type.includes("json")) {
      return Effect.fail(
        new Unusable({ detail: `expected JSON, the reference source answered 200 with ${type}` })
      )
    }
    return response.text.pipe(
      Effect.mapError(() => new Unusable({ detail: "the body could not be read" })),
      Effect.flatMap((body) =>
        Effect.try({
          try: () => JSON.parse(body) as unknown,
          catch: () => new Unusable({ detail: "the body was not JSON" })
        })
      ),
      Effect.flatMap((json) =>
        decode(json).pipe(
          Effect.mapError((issue) =>
            new Unusable({ detail: `the answer did not decode: ${issue.message}` })
          )
        )
      )
    )
  }
}
