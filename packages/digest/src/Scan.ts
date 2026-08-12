/**
 * Reading complete JSON objects out of a stream that may stop mid-word.
 *
 * This exists because of a measured failure. A Provider produced ~1800 tokens —
 * one complete, correctly-cited Finding, then a second one cut off mid-string —
 * and the consumer called `JSON.parse` on the whole answer. It threw at position
 * 343, and the entire document, including the good Finding the reader had
 * already paid for, was discarded as unciteable and blamed on their model.
 *
 * `JSON.parse` is all-or-nothing over a document, so the answer is not to parse
 * a document. The Provider is asked for one JSON object per line and the scanner
 * below hands each one downstream the moment its closing brace arrives. A
 * truncated tail is simply an object that never closes: it is reported as
 * {@link Truncated} and everything before it is already gone.
 *
 * The scan is brace-counting rather than line-splitting, deliberately. Weak
 * models wrap output in ``` fences, emit a top-level array, put two objects on
 * one line, or pretty-print across several — and every one of those is a
 * formatting mistake rather than a citation mistake, so it should cost nothing.
 * Counting braces (while respecting string literals, which is what makes a `}`
 * inside a quote harmless) reads all of them. Text outside an object — prose,
 * fences, commas, brackets — is ignored.
 *
 * Nothing here decides whether an object is a Finding. It emits candidate text;
 * `admit` is still the only door in.
 */

import { type Json, parseJson } from "@parle/domain/Refine"

/** Where the scan has got to. Threaded across chunks; never observed elsewhere. */
export interface Scan {
  /** Brace depth. Greater than zero means an object is open. */
  readonly depth: number
  readonly inString: boolean
  readonly escaped: boolean
  /** The characters of the object currently open. */
  readonly held: string
}

export const emptyScan: Scan = { depth: 0, inString: false, escaped: false, held: "" }

/**
 * One complete object's text, or the news that the answer stopped mid-object.
 *
 * `Truncated` is emitted at most once, at the end, and it is what marks the
 * resulting Digest `partial` rather than failing it.
 */
export type Scanned =
  | { readonly _tag: "Object"; readonly text: string }
  | { readonly _tag: "Truncated" }

export const truncated: Scanned = { _tag: "Truncated" }

/**
 * Advance the scan over one arriving chunk, emitting whatever closed.
 *
 * Shaped for `Stream.mapAccum`: `[state, values]`, values possibly empty. Pure,
 * so a chunk boundary falling anywhere — including inside a string, inside an
 * escape, or between a brace and its object — changes nothing.
 */
export const scan = (state: Scan, chunk: string): readonly [Scan, ReadonlyArray<Scanned>] => {
  let depth = state.depth
  let inString = state.inString
  let escaped = state.escaped
  let held = state.held
  const closed: Array<Scanned> = []

  for (const character of chunk) {
    if (depth > 0) held += character

    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === "\"") inString = false
      continue
    }

    if (character === "\"") {
      // A quote outside any object is prose. Only a quote inside an object can
      // open a string whose braces must not be counted.
      if (depth > 0) inString = true
      continue
    }

    if (character === "{") {
      if (depth === 0) held = "{"
      depth += 1
      continue
    }

    if (character === "}" && depth > 0) {
      depth -= 1
      if (depth === 0) {
        closed.push({ _tag: "Object", text: held })
        held = ""
      }
    }
  }

  return [{ depth, inString, escaped, held }, closed]
}

/** What the end of the stream means, given where the scan stopped. */
export const onHalt = (state: Scan): ReadonlyArray<Scanned> =>
  state.depth > 0 ? [truncated] : []

/**
 * Parse one scanned object, or say it was not usable.
 *
 * Balanced braces do not make valid JSON — a model can close an object it also
 * mangled — so this can still fail, and a failure here is a Garble-shaped fact
 * about one Finding rather than about the answer.
 */
export const parse = (text: string): { readonly ok: true; readonly value: Json } | {
  readonly ok: false
} => {
  const value = parseJson(text)
  if (value === undefined) return { ok: false }
  return { ok: true, value }
}
