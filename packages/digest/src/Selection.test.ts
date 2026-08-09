/**
 * Selection is where the Digest's usefulness is decided. Top-by-score is the
 * obvious strategy and it is the one that buries the strongest objection, so
 * these tests are written as the comparison: what naive top-N would have kept,
 * against what this keeps.
 */
import { describe, expect, it } from "vitest"
import type { Network } from "@parle/domain/Network"
import type { Comment } from "./Brief.ts"
import { defaultLimits, type Limits, objects, selectComments, selectDiscussions } from "./Selection.ts"

const limits: Limits = { ...defaultLimits, commentsPerDiscussion: 10 }

const comment = (id: string, score: number, text: string): Comment => ({
  id,
  author: "someone",
  score,
  text
})

/** What ranking by score alone would have chosen. The thing being argued with. */
const topBy = (comments: ReadonlyArray<Comment>, n: number): ReadonlyArray<string> =>
  [...comments].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, n).map((c) => c.id)

describe("keeping the disagreement", () => {
  /**
   * The shape that actually occurs: early agreement absorbs the votes, and a
   * well-supported objection arrives late and lands just outside the top ten.
   */
  const thread: ReadonlyArray<Comment> = [
    ...Array.from({ length: 12 }, (_, i) => comment(`agree${i}`, 100 - i, "Great write-up, this matches my experience.")),
    comment("dissent", 88, "This is misleading — the benchmark ran on a warmed cache.")
  ]

  it("naive top-N drops the dissenting comment", () => {
    expect(topBy(thread, 10)).not.toContain("dissent")
  })

  it("this selection keeps it, and keeps it near the top", () => {
    const taken = selectComments(thread, limits).map((c) => c.id)
    expect(taken).toContain("dissent")
    expect(taken.indexOf("dissent")).toBeLessThan(2)
  })

  it("still leads with the strongest comment overall", () => {
    // The highest-scoring comment is usually what the conversation was about; a
    // Digest that omitted it would read as being about a different thread.
    expect(selectComments(thread, limits)[0]?.id).toBe("agree0")
  })

  it("leads with the objection when the objection is the strongest comment", () => {
    const led: ReadonlyArray<Comment> = [
      comment("dissent", 500, "This is simply wrong about the licence."),
      comment("agree0", 100, "Useful, thanks."),
      comment("agree1", 90, "Same experience here.")
    ]
    expect(selectComments(led, limits)[0]?.id).toBe("dissent")
  })

  it("does not waste slots when one band runs out", () => {
    const agreementOnly = Array.from({ length: 6 }, (_, i) => comment(`a${i}`, 50 - i, "Agreed."))
    expect(selectComments(agreementOnly, { ...limits, commentsPerDiscussion: 4 })).toHaveLength(4)
  })

  it("drops deleted, removed and empty comments", () => {
    const withHoles: ReadonlyArray<Comment> = [
      comment("kept", 10, "A real point."),
      comment("gone", 900, "[deleted]"),
      comment("also-gone", 800, "[removed]"),
      comment("blank", 700, "   ")
    ]
    expect(selectComments(withHoles, limits).map((c) => c.id)).toEqual(["kept"])
  })

  it("clips a long comment rather than dropping it", () => {
    const long = comment("long", 10, "x".repeat(5_000))
    const taken = selectComments([long], { ...limits, charactersPerComment: 100 })
    expect(taken[0]?.text).toHaveLength(101)
    expect(taken[0]?.text.endsWith("…")).toBe(true)
  })

  it("is stable: the same material selects the same comments", () => {
    const tied = [comment("b", 10, "Agreed."), comment("a", 10, "Agreed."), comment("c", 10, "Agreed.")]
    const once = selectComments(tied, limits).map((c) => c.id)
    const twice = selectComments([...tied].reverse(), limits).map((c) => c.id)
    expect(once).toEqual(twice)
  })
})

describe("the stance test", () => {
  it("does not treat ordinary discourse markers as disagreement", () => {
    // "but", "however" and "actually" classify most of a thread as objection,
    // which collapses the two bands back into one.
    expect(objects(comment("x", 1, "Great post, but the second half is the good bit."))).toBe(false)
    expect(objects(comment("x", 1, "However, I'd add that it also works on iOS."))).toBe(false)
  })

  it("catches explicit contradiction", () => {
    expect(objects(comment("x", 1, "This is misleading."))).toBe(true)
    expect(objects(comment("x", 1, "I disagree with the framing here."))).toBe(true)
    expect(objects(comment("x", 1, "The article ignores the licence question entirely."))).toBe(true)
  })
})

describe("choosing which Discussions are read", () => {
  const on = (network: Network, n: number) =>
    Array.from({ length: n }, (_, i) => ({ network, id: `${network}${i}` }))

  it("gives every Network a slot before any Network gets a second", () => {
    // Reception differs by community, and the strongest objection is very often
    // on the smaller thread on the other Network. Global ranking loses it.
    const chosen = selectDiscussions(
      [...on("hackernews", 8), ...on("reddit", 1)],
      (c) => c.network,
      3
    )
    expect(chosen.map((c) => c.id)).toEqual(["hackernews0", "reddit0", "hackernews1"])
  })

  it("falls back to one Network when only one has anything", () => {
    const chosen = selectDiscussions(on("reddit", 5), (c) => c.network, 3)
    expect(chosen.map((c) => c.id)).toEqual(["reddit0", "reddit1", "reddit2"])
  })

  it("never returns more than the limit, or more than it was given", () => {
    expect(selectDiscussions(on("x", 2), (c) => c.network, 10)).toHaveLength(2)
  })
})
