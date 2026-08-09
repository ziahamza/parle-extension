/**
 * The one claim that never becomes evidence.
 *
 * ADR 0015 allows a merge only on evidence we observed. The three that qualify
 * are uninteresting to test — they map straight through. The interesting case is
 * `SelfDeclared`, because it is the one a well-meaning contributor adds: a page's
 * `rel=canonical` looks like exactly the signal this feature wants, and honouring
 * it would let a publisher merge or split Subjects at will.
 */
import { describe, expect, it } from "vitest"
import * as Option from "effect/Option"
import { type Claim, licensesMerge, observed } from "./Merge.ts"

describe("evidence we observed", () => {
  it("accepts a redirect the reader's own browser traversed", async () => {
    const evidence = observed({ _tag: "Redirected", from: "https://example.com/old" })
    expect(Option.isSome(evidence)).toBe(true)
    expect(Option.isSome(evidence) ? evidence.value._tag : undefined).toBe("Redirected")
  })

  it("accepts a Network's own submitted URL", async () => {
    const evidence = observed({ _tag: "Submitted", network: "hackernews" })
    expect(Option.isSome(evidence) ? evidence.value._tag : undefined).toBe("Submitted")
  })

  it("accepts our own canonicalization rules, carrying the version that ran", async () => {
    const evidence = observed({ _tag: "Canonicalized", rulesVersion: 3 })
    expect(Option.isSome(evidence) && evidence.value._tag === "Canonicalized" ? evidence.value.rulesVersion : undefined)
      .toBe(3)
  })
})

describe("a page's self-declared canonical", () => {
  it("yields no evidence, so there is nothing to hand a merge", async () => {
    // `Recollection.merge` takes `AliasEvidence`. A caller holding only this has
    // nothing to pass it and no way to manufacture one — which is the refusal,
    // rather than a comment asking for it.
    expect(Option.isNone(observed({ _tag: "SelfDeclared", declared: "https://example.com/" }))).toBe(true)
    expect(licensesMerge({ _tag: "SelfDeclared", declared: "https://example.com/" })).toBe(false)
  })

  it("is refused however plausible the address it declares", async () => {
    // The abuse is not exotic: point every article's rel=canonical at the
    // homepage and one 640-point thread attaches to the whole site.
    const declarations: ReadonlyArray<Claim> = [
      { _tag: "SelfDeclared", declared: "https://example.com/" },
      { _tag: "SelfDeclared", declared: "https://example.com/the-very-article" },
      { _tag: "SelfDeclared", declared: "" }
    ]
    for (const claim of declarations) {
      expect(licensesMerge(claim)).toBe(false)
    }
  })
})
