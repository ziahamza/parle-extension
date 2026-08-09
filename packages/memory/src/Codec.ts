/**
 * Total JSON round-tripping for everything either store writes.
 *
 * Both directions are total, and for the same reason the stores are: a blob
 * written by an older build, truncated by a killed worker, or mangled by a
 * profile sync must read back as *absence*, never as a failure and never as a
 * half-decoded value. Absence is a state both stores already handle — it is what
 * an empty store looks like — so nothing downstream grows a new branch.
 *
 * Reads decode through the Schema rather than trusting `JSON.parse`. That is the
 * point of the exercise: a stored Mention whose `subject` went missing between
 * versions must not reappear as a Mention with no Subject, which is precisely the
 * shape `remember` refuses to write in the first place.
 *
 * The schema is taken as a whole type parameter rather than as
 * `Codec<A, I>` so that `Schema.Opaque` classes keep their brand across the
 * call — inferring `A` positionally recovers the underlying struct and quietly
 * strips it.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

/** Any codec that needs no services in either direction. */
export type SelfContained = Schema.Codec<unknown, unknown, never, never>

/**
 * Decode a stored string, or nothing.
 *
 * Logs whatever went wrong. A reader is never shown this and no caller branches
 * on it — the only audience is someone debugging a store that lost a row.
 */
export const readText = <S extends SelfContained>(
  schema: S,
  raw: string,
  what: string
): Effect.Effect<Option.Option<S["Type"]>> =>
  Effect.suspend(() =>
    Effect.try(() => JSON.parse(raw) as unknown).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.map((value) => Option.some(value as S["Type"])),
      Effect.catchCause((cause) =>
        Effect.logWarning(`${what} could not be decoded`, cause).pipe(Effect.as(Option.none<S["Type"]>()))
      )
    )
  )

/**
 * Encode a value for storage, or nothing.
 *
 * Nothing means "do not write", not "write empty" — losing an update is
 * recoverable, and replacing a good row with a bad one is not.
 */
export const writeText = <S extends SelfContained>(
  schema: S,
  value: S["Type"],
  what: string
): Effect.Effect<Option.Option<string>> =>
  Schema.encodeEffect(schema)(value).pipe(
    Effect.flatMap((encoded) => Effect.try(() => JSON.stringify(encoded))),
    Effect.map(Option.some<string>),
    Effect.catchCause((cause) =>
      Effect.logWarning(`${what} could not be encoded`, cause).pipe(Effect.as(Option.none<string>()))
    )
  )
