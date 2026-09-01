import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../entrypoints/pill.content.ts"), "utf8")

describe("the in-page surface", () => {
  it("forgets auto-asked threads when the dock closes", () => {
    const close = source.slice(source.indexOf("const closeSurface"), source.indexOf("const paintFace"))
    expect(close).toContain("resetViewState()")
  })

  it("does not put the dock on the top layer as a popover", () => {
    // Nature crashed (Aw Snap 9) with a full-viewport showPopover dock inside
    // a closed shadow next to Nature's cookie dialog. The mark may still raise.
    expect(source).not.toContain("raise(surface)")
  })

  it("hides a popover before removing the dock", () => {
    const close = source.slice(source.indexOf("const closeSurface"), source.indexOf("const paintFace"))
    expect(close.indexOf("lower(dock)")).toBeGreaterThan(-1)
    expect(close.indexOf("lower(dock)")).toBeLessThan(close.indexOf("dock.remove()"))
  })
})
