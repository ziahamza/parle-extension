/**
 * The citation invariant is the product's highest-trust surface. Three of four
 * independently-designed models had a version of it that a fabricating Provider
 * satisfied trivially, so these tests exist to prove ours is not vacuous.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as HashSet from "effect/HashSet"
import * as Result from "effect/Result"
import { admit, Brief } from "./Digest.ts"
import { Coverage, type Consultation } from "./Coverage.ts"
import { mayAskX } from "./Gate.ts"
import { Mention } from "./Mention.ts"
import { DiscussionId, NativeId } from "./Network.ts"
import { SubjectUrl } from "./Subject.ts"

const page = SubjectUrl.make("https://example.com/a")
const hnId = (nativeId: string) =>
  DiscussionId.make({ network: "hackernews", nativeId: NativeId.make(nativeId) })

/** A Brief that was given exactly one Hacker News Discussion. */
const briefWith = (keys: ReadonlyArray<string>) =>
  Brief.of({
    subject: "https://example.com/a",
    contains: (id) => keys.includes(`${id.network} ${id.nativeId}`)
  })

const digestCiting = (network: string, nativeId: string) => ({
  subject: "https://example.com/a",
  origin: { _tag: "Local", providerId: "codex", model: "gpt-5" },
  completeness: "complete",
  findings: [
    {
      statement: "Commenters dispute the benchmark methodology.",
      contested: true,
      citations: [{ discussion: { network, nativeId } }]
    }
  ]
})

const run = <A, E>(eff: Effect.Effect<A, E, Brief>, brief: Brief["Service"]) =>
  Effect.runSync(Effect.result(eff.pipe(Effect.provideService(Brief, brief))))

describe("the citation invariant", () => {
  it("ACCEPTS a Finding citing a Discussion that is in the Brief", () => {
    const out = run(admit(digestCiting("hackernews", "41293011")), briefWith(["hackernews 41293011"]))
    expect(Result.isSuccess(out)).toBe(true)
  })

  it("REJECTS a Finding citing a Discussion the Provider invented", () => {
    const out = run(admit(digestCiting("reddit", "t3_9zzzzz")), briefWith(["hackernews 41293011"]))
    expect(Result.isFailure(out)).toBe(true)
  })

  it("REJECTS a cross-Network id collision", () => {
    // A Reddit permalink whose base-36 id equals an HN item id. Keyed on the
    // bare id this is accepted; keyed on the pair it is not.
    const out = run(digestCitingReddit(), briefWith(["hackernews 1abc2de"]))
    expect(Result.isFailure(out)).toBe(true)
  })

  const digestCitingReddit = () => admit(digestCiting("reddit", "1abc2de"))

  it("REJECTS a Finding with no citations at all", () => {
    const out = run(
      admit({
        subject: "https://example.com/a",
        origin: { _tag: "Local", providerId: "codex", model: "gpt-5" },
        completeness: "complete",
        findings: [{ statement: "Everyone agrees.", contested: false, citations: [] }]
      }),
      briefWith(["hackernews 41293011"])
    )
    expect(Result.isFailure(out)).toBe(true)
  })

  it("REJECTS a Digest with no Findings", () => {
    const out = run(
      admit({
        subject: "https://example.com/a",
        origin: { _tag: "Local", providerId: "codex", model: "gpt-5" },
        completeness: "complete",
        findings: []
      }),
      briefWith(["hackernews 41293011"])
    )
    expect(Result.isFailure(out)).toBe(true)
  })
})

describe("the two tiers stay apart at runtime", () => {
  const linked = Mention.cases.Linked.make({
    subject: page,
    discussion: hnId("1"),
    viaAlias: "https://example.com/a"
  })
  const passing = Mention.cases.Passing.make({
    subject: page,
    discussion: hnId("1"),
    inComment: "9001"
  })

  it("does not collapse a Linked and a Passing Mention of the same Discussion", () => {
    // Opaque brands over IDENTICAL fields return true here and a HashSet keeps
    // only whichever arrived first. Structurally different cases do not. The
    // third tier this used to check, Topical, is gone; the invariant it was
    // guarding is not, because one thread can still both link a page and be
    // linked from a comment on it.
    expect(Equal.equals(linked, passing)).toBe(false)
    expect(HashSet.size(HashSet.make(linked, passing))).toBe(2)
  })
})

describe("the X gate", () => {
  const coverage = (consultations: ReadonlyArray<Consultation>) =>
    Coverage.make({ subject: "https://example.com/a", consultations })

  const hn = { _tag: "Network", network: "hackernews" } as const

  it("does not open on a Passing Mention alone", () => {
    // Someone pasting the address into a thread about something else does not
    // make it the subject of a public conversation, so the disclosure argument
    // is void. This used to be asserted of a Topical Mention; that tier is
    // gone and Passing is now the weak evidence the gate has to refuse.
    const passing = Mention.cases.Passing.make({
      subject: page,
      discussion: hnId("1"),
      inComment: "9001"
    })
    const out = mayAskX(coverage([{ _tag: "Answered", place: hn, mentions: [passing] }]))
    expect(Result.isFailure(out)).toBe(true)
  })

  it("opens on a Linked Mention", () => {
    const linked = Mention.cases.Linked.make({
      subject: page,
      discussion: hnId("41293011"),
      viaAlias: "https://example.com/a"
    })
    const out = mayAskX(coverage([{ _tag: "Answered", place: hn, mentions: [linked] }]))
    expect(Result.isSuccess(out)).toBe(true)
  })

  it("settles rather than hanging when every Network comes back empty", () => {
    // The Deferred formulation of this gate waits forever, with no error, on
    // exactly this input — and it is the common case, not an edge case.
    const out = mayAskX(
      coverage([
        { _tag: "Silence", place: hn },
        { _tag: "Refusal", place: { _tag: "Network", network: "reddit" }, reason: "forbidden" }
      ])
    )
    expect(Result.isFailure(out)).toBe(true)
  })
})

describe("an explicit reader request", () => {
  const empty = Coverage.make({
    subject: "https://example.com/a",
    consultations: [{ _tag: "Silence", place: { _tag: "Network", network: "hackernews" } }]
  })

  it("reaches X even with no Linked Mention", () => {
    expect(Result.isSuccess(mayAskX(empty, "reader-asked"))).toBe(true)
  })

  it("but an automatic Enquiry on the same Coverage still does not", () => {
    expect(Result.isFailure(mayAskX(empty, "automatic"))).toBe(true)
  })

  it("defaults to automatic when the impetus is not stated", () => {
    expect(Result.isFailure(mayAskX(empty))).toBe(true)
  })
})
