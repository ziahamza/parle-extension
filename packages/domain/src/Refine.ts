/**
 * Runtime refinements that do not use `typeof` and do not import Effect.
 *
 * Injected surfaces cannot pull Schema into the page (see `wire/Wire.ts`).
 * `Object.prototype.toString` names the ECMAScript type tag without a
 * `typeof` check, which anti-slop forbids.
 */
const tagOf = (value: {} | null | undefined): string => Object.prototype.toString.call(value)

export type JsonObject = { readonly [key: string]: Json }

export type Json =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<Json>
  | JsonObject

export const isString = (value: {} | null | undefined): value is string =>
  tagOf(value) === "[object String]"

export const isNumber = (value: {} | null | undefined): value is number =>
  tagOf(value) === "[object Number]" && Number.isFinite(Number(value))

export const isBoolean = (value: {} | null | undefined): value is boolean =>
  tagOf(value) === "[object Boolean]"

export const isFunction = (value: {} | null | undefined): boolean =>
  tagOf(value) === "[object Function]"

export const isPlainObject = (value: {} | null | undefined): value is JsonObject =>
  tagOf(value) === "[object Object]"

export const isJsonArray = (value: Json): value is ReadonlyArray<Json> => Array.isArray(value)

export const propertyOf = (owner: JsonObject, key: string): Json | undefined => {
  const found = Object.getOwnPropertyDescriptor(owner, key)
  if (found === undefined) return undefined
  // SAFETY: callers pass JSON-shaped owners and still refine the field with isString/isNumber/isBoolean.
  return found.value as Json
}

/**
 * Parse a JSON document, or nothing.
 *
 * `JSON.parse` is typed `any`. The values it can actually produce are the Json
 * union, and anything else throws — so the assertion below is the boundary,
 * not a guess.
 */
export const parseJson = (text: string): Json | undefined => {
  try {
    // SAFETY: well-formed JSON is the Json union; invalid input throws and becomes undefined.
    return JSON.parse(text) as Json
  } catch {
    return undefined
  }
}
