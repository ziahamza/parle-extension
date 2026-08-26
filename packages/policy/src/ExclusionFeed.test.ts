import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"
import { readArtifact } from "./ExclusionFeed.ts"
import { seed, withUpdate } from "./Seed.ts"

describe("ExclusionFeed", () => {
  it("reads a published artifact", () => {
    const read = readArtifact(JSON.stringify({
      version: 3,
      entries: [{ domain: "Example-Bank.co.uk", category: "banking" }]
    }))
    expect(Option.isSome(read)).toBe(true)
    if (Option.isSome(read)) {
      expect(read.value.version).toBe(3)
      // Hosts compare lowercased everywhere else; the artifact is normalised
      // on the way in rather than trusted to arrive that way.
      expect(read.value.entries).toEqual([{ domain: "example-bank.co.uk", category: "banking" }])
    }
  })

  it("refuses everything that is not an artifact", () => {
    for (
      const body of [
        "not json",
        "null",
        "[]",
        JSON.stringify({ entries: [] }),
        JSON.stringify({ version: -1, entries: [] }),
        JSON.stringify({ version: 1.5, entries: [] }),
        JSON.stringify({ version: 1, entries: "all of them" }),
        JSON.stringify({ version: 1, entries: [null] }),
        JSON.stringify({ version: 1, entries: [{ domain: "", category: "banking" }] }),
        JSON.stringify({ version: 1, entries: [{ domain: "a.com", category: 7 }] })
      ]
    ) {
      expect(Option.isNone(readArtifact(body)), body).toBe(true)
    }
  })

  it("drops an entry in a vocabulary this build has never heard of, and keeps the rest", () => {
    // A newer publisher naming a new category must not cost an older install
    // the entries it still understands — and must not reach the settings
    // page, which has no words for it.
    const read = readArtifact(JSON.stringify({
      version: 2,
      entries: [
        { domain: "new-thing.example", category: "quantum-chat" },
        { domain: "old-thing.example", category: "webmail" }
      ]
    }))
    expect(Option.isSome(read)).toBe(true)
    if (Option.isSome(read)) {
      expect(read.value.entries).toEqual([{ domain: "old-thing.example", category: "webmail" }])
    }
  })

  it("a read artifact folds into the seed additively, exactly as withUpdate promises", () => {
    const read = readArtifact(JSON.stringify({
      version: seed.version + 1,
      entries: [{ domain: "missed-bank.example", category: "banking" }]
    }))
    expect(Option.isSome(read)).toBe(true)
    if (Option.isSome(read)) {
      const folded = withUpdate(seed, read.value)
      expect(folded.version).toBe(seed.version + 1)
      expect(folded.entries.length).toBe(seed.entries.length + 1)
      expect(folded.entries.some((one) => one.domain === "missed-bank.example")).toBe(true)
    }
  })
})
