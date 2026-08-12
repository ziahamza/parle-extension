/**
 * The scanner exists because `JSON.parse` is all-or-nothing over a document and
 * a streamed answer is not a document. These tests pin the cases that actually
 * arrive from weak models.
 */
import { describe, expect, it } from "vitest"
import { emptyScan, onHalt, parse, type Scan, type Scanned, scan } from "./Scan.ts"

/** Feed a whole answer through in the given pieces, as a Provider would. */
const feed = (chunks: ReadonlyArray<string>) => {
  let state: Scan = emptyScan
  const out: Array<Scanned> = []
  for (const chunk of chunks) {
    const [next, closed] = scan(state, chunk)
    state = next
    out.push(...closed)
  }
  out.push(...onHalt(state))
  return {
    objects: out.flatMap((s) => s._tag === "Object" ? [s.text] : []),
    truncated: out.some((s) => s._tag === "Truncated")
  }
}

describe("reading objects out of a stream", () => {
  it("emits an object as soon as it closes, not when the stream ends", () => {
    const [afterFirst, closed] = scan(emptyScan, `{"a":1}{"b":2`)
    expect(closed).toEqual([{ _tag: "Object", text: `{"a":1}` }])
    expect(afterFirst.depth).toBe(1)
  })

  it("survives a chunk boundary falling anywhere", () => {
    const whole = `{"statement":"they disagreed","contested":true}`
    for (let cut = 0; cut <= whole.length; cut += 1) {
      const fed = feed([whole.slice(0, cut), whole.slice(cut)])
      expect(fed.objects).toEqual([whole])
      expect(fed.truncated).toBe(false)
    }
  })

  it("reports a truncated tail and keeps everything before it", () => {
    // The measured failure: one good object, then the answer stops mid-string.
    const fed = feed([`{"a":1}\n`, `{"b":"half a sen`])
    expect(fed.objects).toEqual([`{"a":1}`])
    expect(fed.truncated).toBe(true)
  })

  it("does not count a brace inside a string", () => {
    const fed = feed([`{"statement":"the } was the problem"}`])
    expect(fed.objects).toEqual([`{"statement":"the } was the problem"}`])
    expect(fed.truncated).toBe(false)
  })

  it("does not count an escaped quote as closing a string", () => {
    const text = `{"statement":"they said \\"no}\\" repeatedly"}`
    expect(feed([text]).objects).toEqual([text])
  })

  it("reads through markdown fences and a wrapping array", () => {
    // Not the format we asked for. It is a formatting mistake, not a citation
    // mistake, and it must not cost the reader their Findings.
    const fed = feed(["```json\n[\n  {\"a\":1},\n  {\"b\":2}\n]\n```\n"])
    expect(fed.objects).toEqual([`{"a":1}`, `{"b":2}`])
    expect(fed.truncated).toBe(false)
  })

  it("keeps nested objects whole", () => {
    const text = `{"citations":[{"discussion":{"network":"hackernews","nativeId":"1"}}]}`
    expect(feed([text]).objects).toEqual([text])
  })

  it("emits nothing, and no truncation, for an answer with no objects at all", () => {
    const fed = feed(["I'm sorry, I can't help with that.\n"])
    expect(fed.objects).toEqual([])
    expect(fed.truncated).toBe(false)
  })
})

describe("parsing a scanned object", () => {
  it("reads a balanced object", () => {
    expect(parse(`{"a":1}`)).toEqual({ ok: true, value: { a: 1 } })
  })

  it("says so rather than throwing when the braces balanced but the JSON did not", () => {
    expect(parse(`{"a":,}`).ok).toBe(false)
  })
})
