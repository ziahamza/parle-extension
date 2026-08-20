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

  it("is deterministic: the same material in the same order selects the same comments", () => {
    // This test used to assert something stronger — that a REVERSED input
    // selected identically, which the id tie-break bought. That philosophy is
    // gone on purpose: the input order is part of the material (it is the
    // site's own ranking, carried by the Comments seam), so reversing the
    // input legitimately reverses tied preferences. What must still hold is
    // that the same thread read twice yields the same Brief.
    const tied = [comment("b", 10, "Agreed."), comment("a", 10, "Agreed."), comment("c", 10, "Agreed.")]
    const once = selectComments(tied, limits).map((c) => c.id)
    const twice = selectComments([...tied], limits).map((c) => c.id)
    expect(once).toEqual(twice)
  })

  it("breaks ties by the order the site showed them, not by id", () => {
    const tied = [comment("b", 10, "Agreed."), comment("a", 10, "Agreed."), comment("c", 10, "Agreed.")]
    expect(selectComments(tied, limits).map((c) => c.id)).toEqual(["b", "a", "c"])
    expect(selectComments([...tied].reverse(), limits).map((c) => c.id)).toEqual(["c", "a", "b"])
  })

  /**
   * The Hacker News case, which is not an edge case there: Algolia reports
   * `points: null` for nearly every comment, so before the tie-break changed,
   * EVERY Hacker News Brief was selected in id order — chronological, since
   * ids are monotonic — and read the thread's oldest comments rather than the
   * ones its own page ranks first. The seam has delivered comments in page
   * order since the panel fix; this is the Digest finally reading it.
   */
  it("reads an unscored thread in the order its page ranks it, not its oldest comments first", () => {
    const unscored = (id: string, text: string): Comment => ({ id, author: "someone", score: null, text })
    // Page order deliberately disagrees with id order everywhere.
    const thread = [
      unscored("90009", "The top-ranked comment, posted last."),
      unscored("10001", "The oldest comment, ranked mid-thread."),
      unscored("50005", "A mid-age comment, ranked third.")
    ]
    expect(selectComments(thread, limits).map((c) => c.id)).toEqual(["90009", "10001", "50005"])
    // And a single real score still outranks every null, wherever it sits.
    const oneScored = [...thread, { ...unscored("70007", "Actually counted."), score: 3 }]
    expect(selectComments(oneScored, limits)[0]?.id).toBe("70007")
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
