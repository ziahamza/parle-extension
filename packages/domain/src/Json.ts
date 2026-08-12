/**
 * Unparsed JSON, as a named owner type rather than `unknown`.
 *
 * Anti-slop forbids `unknown` on function contracts. The values that actually
 * arrive untyped — `JSON.parse`, `chrome.runtime` notes, a URL's response body —
 * are JSON, so that is the type the boundary speaks. Decode from here into a
 * domain schema; do not narrow with `typeof`.
 */
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { isBoolean, isNumber, isString, type Json, type JsonObject } from "./Refine.ts"

export { isBoolean, isFunction, isJsonArray, isNumber, isPlainObject, isString, parseJson } from "./Refine.ts"
export type { Json, JsonObject } from "./Refine.ts"

export const Json: Schema.Codec<Json> = Schema.suspend(() =>
  Schema.Union([
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(Json),
    Schema.Record(Schema.String, Json)
  ])
)

export const JsonObject: Schema.Codec<JsonObject> = Schema.Record(Schema.String, Json)

export const isJson = Schema.is(Json)
export const isJsonObject = Schema.is(JsonObject)

export const jsonOf = Schema.decodeUnknownOption(Json)
export const jsonObjectOf = Schema.decodeUnknownOption(JsonObject)

export const stringOf = (value: Json): string | null => isString(value) ? value : null
export const numberOf = (value: Json): number | null => isNumber(value) ? value : null
export const booleanOf = (value: Json): boolean | null => isBoolean(value) ? value : null

export const objectOf = (value: Json): JsonObject | null =>
  Option.getOrNull(jsonObjectOf(value))

export const fieldOf = (value: Json, key: string): Json | null => {
  const record = objectOf(value)
  if (record === null) return null
  return record[key] ?? null
}
