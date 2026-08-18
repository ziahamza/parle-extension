import { describe, expect, it } from "vitest"

import { PANEL_STYLES } from "./styles.ts"

/**
 * The stylesheet is a template literal, which makes one mistake very easy and
 * very confusing.
 *
 * A backtick anywhere inside it — including inside a CSS comment, where it is
 * the natural way to quote a selector or a property — closes the literal. The
 * rest of the file then parses as TypeScript, and the error surfaces as
 * `Expected ";" but found "var"` pointing at a line of prose. It happened three
 * times in one afternoon while commenting this file.
 *
 * These tests are cheap and they fail at the right place with the right words.
 */
describe("the panel stylesheet", () => {
  it("survives being a template literal", () => {
    expect(PANEL_STYLES).not.toContain("`")
    expect(PANEL_STYLES.length).toBeGreaterThan(1000)
  })

  it("has balanced CSS comments and braces", () => {
    expect(PANEL_STYLES.split("/*").length).toBe(PANEL_STYLES.split("*/").length)
    expect(PANEL_STYLES.split("{").length).toBe(PANEL_STYLES.split("}").length)
  })

  /**
   * The close button is positioned rather than laid out, because it is a child
   * of the dock and not of the row it appears to sit in. Deriving its offset
   * from the row height is what keeps it aligned with the gear beside it;
   * `parle.e2e.ts` measures the result in a real browser, and this only holds
   * the mechanism in place so that measurement stays meaningful.
   */
  it("derives the close button's position from the navigation row", () => {
    expect(PANEL_STYLES).toContain("--parle-nav-h")
    expect(PANEL_STYLES).toContain("--parle-close-size")
    // `[^)]*` would stop at the `)` of the `env(...)` that precedes the variable.
    expect(PANEL_STYLES).toMatch(/top:\s*calc\([\s\S]*?--parle-nav-h/)
  })
})
