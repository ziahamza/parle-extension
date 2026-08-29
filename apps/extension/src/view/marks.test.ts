import { describe, expect, it } from "vitest"
import { mountDouble } from "./domDouble.ts"
import { networksOn, stackFace, tabMark } from "./marks.ts"

describe("network marks", () => {
  it("lists Networks in a stable product order, not by loudness", () => {
    expect(
      networksOn([
        { network: "lobsters" },
        { network: "x" },
        { network: "lemmy" },
        { network: "reddit" },
        { network: "bluesky" },
        { network: "hackernews" },
        { network: "reddit" }
      ])
    ).toEqual(["hackernews", "reddit", "x", "bluesky", "lemmy", "lobsters"])
  })

  it("draws a distinct mark for every Network, and never a blank one", () => {
    // A Network with no glyph puts an empty span in the stack and in the nav —
    // a destination the reader can see and cannot identify. Distinctness is
    // asserted on the drawn markup rather than on the colour, because two of
    // the six are reds.
    mountDouble()
    const drawn = new Set<string>()
    for (
      const network of ["hackernews", "reddit", "x", "bluesky", "lemmy", "lobsters"] as const
    ) {
      const mark = tabMark(network)
      expect(mark.className).toContain(`parle-tab-mark-${network}`)
      const glyph = mark.children[0]
      expect(glyph).toBeDefined()
      expect(glyph?.children.length).toBeGreaterThan(0)
      drawn.add(JSON.stringify(
        Array.from(glyph?.children ?? []).map((child) => [
          child.tagName,
          child.getAttribute("fill"),
          child.getAttribute("d"),
          child.textContent
        ])
      ))
    }
    expect(drawn.size).toBe(6)
  })

  it("builds a stacked face with one disc per Network", () => {
    mountDouble()
    const face = stackFace(["hackernews", "reddit"])
    expect(face.className).toBe("parle-stack")
    expect(face.dataset.count).toBe("2")
    expect(face.children).toHaveLength(2)
  })

  it("falls back to Parle's own bubble when nowhere is speaking", () => {
    mountDouble()
    const face = stackFace([])
    expect(face.children).toHaveLength(1)
    expect(face.children[0]?.className).toContain("parle-stack-parle")
  })

  it("marks a conversation tab with the Network's glyph", () => {
    mountDouble()
    const mark = tabMark("hackernews")
    expect(mark.className).toContain("parle-tab-mark-hackernews")
    expect(mark.children.length).toBeGreaterThan(0)
  })
})
