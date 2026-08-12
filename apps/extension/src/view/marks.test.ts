import { describe, expect, it } from "vitest"
import { mountDouble } from "./domDouble.ts"
import { networksOn, stackFace, tabMark } from "./marks.ts"

describe("network marks", () => {
  it("lists Networks in a stable product order, not by loudness", () => {
    expect(
      networksOn([
        { network: "x" },
        { network: "reddit" },
        { network: "hackernews" },
        { network: "reddit" }
      ])
    ).toEqual(["hackernews", "reddit", "x"])
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
