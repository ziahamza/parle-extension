import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * The gate numbers, held to each other.
 *
 * `HANDOFF.md`, `BATTLE.md` and two workflow files each state how many
 * behaviour checks and unit tests there are, in six places between them. Adding
 * a check means editing all six, and twice now a review has caught a rewritten
 * count sitting next to an unrewritten one — a runbook that says 1,241 on one
 * screen and 1,244 two screens up.
 *
 * This does not run the suites; it asserts the *claims agree with each other*
 * and with the count of `record(` calls in the behaviour file, which is what
 * the suite reports. Disagreement is the whole failure mode — a set of numbers
 * that are consistently one behind reality is a smaller problem than a set that
 * contradicts itself, and the first is caught by reading the run output.
 *
 * The ADRs are deliberately not included. `docs/adr/0018` says 1,300 and `0020`
 * says 1,302 because those were true on the day each was accepted; a decision
 * record that silently tracks the present tells you nothing about the past.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (relative: string): string => readFileSync(join(root, relative), "utf8")

const behaviours = (): number => {
  const source = read("apps/extension/e2e/parle.e2e.ts")
  return (source.match(/\brecord\(/g) ?? []).length
}

/**
 * Every "N behaviour(s)" / "N-check" / "N/N" claim in a file, as numbers.
 *
 * Counts written about something that no longer exists are skipped: BATTLE
 * records that "the 17-check title race is gone", which is a fact about a
 * deleted suite rather than a claim about this one. Matching it would force the
 * history to be rewritten every time the gate grows.
 */
const claimed = (text: string): ReadonlyArray<number> =>
  [
    ...text.matchAll(/\b(\d{2,3})(?: behaviour| behaviours|-check| behaviour checks)/g),
    ...text.matchAll(/\be2e (\d{2,3})\/\d{2,3}/g),
    ...text.matchAll(/`pnpm e2e` at (\d{2,3})\/\d{2,3}/g)
  ]
    .filter((m) => {
      const at = m.index ?? 0
      const around = text.slice(Math.max(0, at - 40), at + 160)
      return !/\b(gone|deleted)\b/.test(around)
    })
    .map((m) => Number(m[1]))

describe("the gate numbers", () => {
  it("are the same everywhere they are stated", () => {
    const truth = behaviours()
    expect(truth).toBeGreaterThan(0)

    const sources: ReadonlyArray<readonly [string, string]> = [
      ["HANDOFF.md", read("HANDOFF.md")],
      ["apps/extension/e2e/BATTLE.md", read("apps/extension/e2e/BATTLE.md")],
      [".github/workflows/ci.yml", read(".github/workflows/ci.yml")],
      [".github/workflows/release.yml", read(".github/workflows/release.yml")]
    ]

    // 48 is the torture suite, which lives in its own file and is not counted here.
    const wrong = sources.flatMap(([name, text]) =>
      claimed(text).filter((n) => n !== truth && n !== 48).map((n) => `${name} says ${n}`)
    )
    expect(wrong, `parle.e2e.ts has ${truth} record() calls`).toEqual([])
  })

  it("state the same unit-test total in both runbooks", () => {
    const of = (text: string): ReadonlyArray<string> =>
      [...text.matchAll(/([\d,]{4,7}) unit tests/g)].map((m) => m[1] as string)

    const handoff = of(read("HANDOFF.md"))
    const battle = of(read("apps/extension/e2e/BATTLE.md"))
    expect(handoff.length, "HANDOFF.md no longer states a unit-test total").toBeGreaterThan(0)
    expect(battle.length, "BATTLE.md no longer states a unit-test total").toBeGreaterThan(0)
    expect(new Set([...handoff, ...battle]).size, `HANDOFF says ${handoff}, BATTLE says ${battle}`).toBe(1)
  })
})
