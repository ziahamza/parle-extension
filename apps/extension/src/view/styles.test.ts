import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * These read `styles.ts` as **text**, and that is the whole point.
 *
 * The first version of this file imported `PANEL_STYLES` and asserted the
 * string contained no backtick. That could never fail for the reason it named:
 * a stray backtick inside the template literal is a parse error, so the module
 * never loads, so the assertion never runs — the suite dies with
 * `Expected ";" but found "var"` pointing at a line of prose, which is exactly
 * the confusing failure the test was meant to replace.
 *
 * Reading the source means the check survives the file being unparseable, and
 * can say what is actually wrong.
 */
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.ts"), "utf8")

/** The CSS between the fences, without the surrounding TypeScript. */
const cssBody = (): string => {
  const open = source.indexOf("export const PANEL_STYLES = `")
  expect(open, "PANEL_STYLES template literal not found").toBeGreaterThan(-1)
  const start = source.indexOf("`", open) + 1
  const end = source.indexOf("\n`", start)
  expect(end, "PANEL_STYLES is not closed on its own line").toBeGreaterThan(start)
  return source.slice(start, end)
}

describe("the panel stylesheet source", () => {
  it("contains no backtick inside the template literal", () => {
    const stray = cssBody().indexOf("`")
    const where = stray === -1 ? "" : cssBody().slice(Math.max(0, stray - 60), stray + 20)
    expect(
      stray,
      "A backtick inside PANEL_STYLES closes the template literal. Everything after it " +
        "parses as TypeScript, and the error you get points at prose rather than at the " +
        `backtick. Use plain words in CSS comments. Near: …${where}`
    ).toBe(-1)
  })

  /**
   * Braces are counted outside comments, because `}` inside a comment balances
   * a `{` that was never opened — the vacuous-check trap HANDOFF §4 warns about.
   */
  it("has balanced braces outside its comments", () => {
    const withoutComments = cssBody().replace(/\/\*[\s\S]*?\*\//g, "")
    const opens = (withoutComments.match(/{/g) ?? []).length
    const closes = (withoutComments.match(/}/g) ?? []).length
    expect(opens, "unbalanced braces in PANEL_STYLES").toBe(closes)
  })

  it("closes every comment it opens", () => {
    const body = cssBody()
    expect((body.match(/\/\*/g) ?? []).length).toBe((body.match(/\*\//g) ?? []).length)
  })

  /**
   * The close button is positioned rather than laid out — it is a child of the
   * dock, not of the row it appears to sit in. Centring it on that row is only
   * correct where the row IS the header, which is one media query; outside it
   * the row is the footer. `parle.e2e.ts` measures the outcome in a real
   * browser and asks which layout it is in first.
   */
  it("centres the close button on the navigation row only where that row is the header", () => {
    const body = cssBody()
    expect(body).toContain("--parle-nav-h")
    expect(body).toContain("--parle-close-size")

    const query = body.indexOf("@media (min-width: 640px) and (hover: hover) and (pointer: fine)")
    expect(query, "the pointer-driven desktop query is gone").toBeGreaterThan(-1)

    const centring = body.indexOf("--parle-nav-h) - var(--parle-close-size)")
    expect(centring, "the close button no longer derives its offset from the row").toBeGreaterThan(-1)
    expect(
      centring,
      "the nav-relative offset must live inside the query that puts nav at the top; " +
        "outside it the row is the footer and the button has nothing to align with"
    ).toBeGreaterThan(query)
  })
})
