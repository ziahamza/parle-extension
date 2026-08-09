import { describe, expect, it } from "vitest"
import { anchorAt, resolve } from "./Selection.ts"

describe("anchoring a selection so it survives the page changing", () => {
  it("finds its text again after the surrounding document is rewritten", () => {
    // A single-page app re-renders the article body on hydration and on
    // navigation. Every node-identity anchor dies at that moment; a quote does
    // not, and that is the whole reason this is a quote.
    const before = "Intro paragraph. The unwind is orderly, say commenters. Closing."
    const anchor = anchorAt(before, before.indexOf("The unwind"), before.indexOf(", say"))
    expect(anchor).not.toBeNull()

    const after = `A newly inserted lede. ${before} And a footer nobody had before.`
    const at = resolve(after, anchor!)
    expect(after.slice(at, at + anchor!.exact.length)).toBe(anchor!.exact)
  })

  it("picks the right occurrence when the same phrase appears more than once", () => {
    const text = "he said no comment here, and later he said no comment there"
    const second = text.lastIndexOf("no comment")
    const anchor = anchorAt(text, second, second + "no comment".length)
    expect(resolve(text, anchor!)).toBe(second)
  })

  it("says the text is gone rather than guessing at a wrong one", () => {
    const anchor = anchorAt("the quick brown fox", 4, 9)
    expect(resolve("nothing of the sort remains", anchor!)).toBe(-1)
  })

  it("takes no anchor from an empty or whitespace-only selection", () => {
    expect(anchorAt("some text", 4, 4)).toBeNull()
    expect(anchorAt("some    text", 4, 8)).toBeNull()
  })
})
