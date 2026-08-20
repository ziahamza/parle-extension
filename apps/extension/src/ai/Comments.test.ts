/**
 * Reading comment bodies: the shapes the two Networks really answer with, and
 * the promise that nothing here can fail.
 *
 * The seam's contract is `Effect<Option<Contents>>` — no error channel at all —
 * and that is not tidiness. A Reddit 403 is ADR 0013's ordinary path, so a
 * Discussion we cannot read has to cost the reader that one Discussion rather
 * than the whole Digest that Hacker News could have carried on its own. Every
 * test below that hands the reader a broken answer is checking that promise.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Comments } from "@parle/digest/Comments"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { type Exchange, recording } from "@parle/networks/Recording"
import { defaultLimits, selectComments } from "@parle/digest/Selection"
import * as ReadComments from "./Comments.ts"

const idOf = (network: "hackernews" | "reddit" | "x", nativeId: string): DiscussionId =>
  DiscussionId.make({ network, nativeId: NativeId.make(nativeId) })

const read = async (id: DiscussionId, answer: (url: string) => Exchange) => {
  const wire = recording(answer)
  const contents = await Effect.runPromise(
    Effect.flatMap(Comments, (comments) => comments.of(id)).pipe(
      Effect.provide(ReadComments.layer.pipe(Layer.provide(wire.layer)))
    )
  )
  return { contents, asked: [...wire.asked] }
}

const json = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json" }
})

describe("Hacker News", () => {
  const item = json(JSON.stringify({
    id: 1,
    type: "story",
    title: "A thread",
    points: 640,
    children: [
      { id: 11, type: "comment", author: "ada", points: 12, text: "<p>First &amp; foremost</p>" },
      {
        id: 12,
        type: "comment",
        author: null,
        // A deleted comment: no text at all, which a strict schema would turn
        // into an unreadable Discussion.
        text: null,
        children: [
          { id: 13, type: "comment", author: "grace", points: null, text: "<i>Nested</i> reply" }
        ]
      }
    ]
  }))

  it("flattens the tree, so a reply is as available as a top-level comment", async () => {
    const { contents, asked } = await read(idOf("hackernews", "1"), () => item)
    // Two requests, both carrying the thread's id and nothing else: the tree
    // from Algolia, and the thread's own page for the order Hacker News shows
    // it in — which no API carries.
    expect(asked).toEqual([
      "https://hn.algolia.com/api/v1/items/1",
      "https://news.ycombinator.com/item?id=1"
    ])
    if (Option.isNone(contents)) throw new Error("expected comments")
    expect(contents.value.title).toBe("A thread")
    expect(contents.value.score).toBe(640)
    expect(contents.value.comments.map((c) => c.id)).toEqual(["11", "13"])
    expect(contents.value.comments.map((c) => [c.parentId, c.depth])).toEqual([
      [null, 0],
      ["12", 1]
    ])
  })

  it("hands the model text rather than markup", async () => {
    const { contents } = await read(idOf("hackernews", "1"), () => item)
    if (Option.isNone(contents)) throw new Error("expected comments")
    expect(contents.value.comments[0]?.text).toBe("First & foremost")
    expect(contents.value.comments[1]?.text).toBe("Nested reply")
  })

  it("says the Network did not give a score rather than saying zero", async () => {
    // A missing score is not the worst comment in the thread; Selection ranks
    // it last rather than beneath everything with a real number.
    const { contents } = await read(idOf("hackernews", "1"), () => item)
    if (Option.isNone(contents)) throw new Error("expected comments")
    expect(contents.value.comments[1]?.score).toBeNull()
    // And it does not invent a comment count out of the tree it happened to
    // walk — that would report our own cap as the size of the conversation.
    expect(contents.value.commentCount).toBeNull()
  })

  it("does not report a thread whose comments it could not read", async () => {
    const empty = json(JSON.stringify({ id: 1, type: "story", title: "A thread", children: [] }))
    const { contents, asked } = await read(idOf("hackernews", "1"), () => empty)
    // A Brief of a title with no conversation under it is a model summarising
    // a title, which is the one output ADR 0006 calls a bug.
    expect(Option.isNone(contents)).toBe(true)
    // And a tree with nothing to order never costs the page request.
    expect(asked).toEqual(["https://hn.algolia.com/api/v1/items/1"])
  })

  /**
   * The bug this order exists to fix, measured on a live thread (Go 1.27,
   * 2026-08-20): Algolia returned patabyte, piinbinary, jeanbza… oldest-first,
   * and news.ycombinator.com showed a different conversation entirely. The
   * panel must read in the order the thread's own page does.
   */
  describe("the page's own order", () => {
    const tree = json(JSON.stringify({
      id: 1,
      type: "story",
      title: "A thread",
      points: 100,
      children: [
        { id: 11, type: "comment", author: "earliest", points: null, text: "first by the clock" },
        {
          id: 12,
          type: "comment",
          author: "middle",
          points: null,
          text: "second by the clock",
          children: [
            { id: 121, type: "comment", author: "reply-old", points: null, text: "older reply" },
            { id: 122, type: "comment", author: "reply-new", points: null, text: "newer reply" }
          ]
        },
        { id: 13, type: "comment", author: "latest", points: null, text: "third by the clock" }
      ]
    }))
    /** The page ranks the newest root first and the newer reply first. */
    const page = (url: string): Exchange =>
      url.startsWith("https://news.ycombinator.com/")
        ? {
          status: 200,
          headers: { "content-type": "text/html" },
          body: [
            "<tr class='athing comtr' id='13'>",
            "<tr class='athing comtr' id='12'>",
            "<tr class='athing comtr' id='122'>",
            "<tr class='athing comtr' id='121'>",
            "<tr class='athing comtr' id='11'>"
          ].join("\n")
        }
        : tree

    it("reads siblings in the order the thread's page shows them, at every depth", async () => {
      const { contents } = await read(idOf("hackernews", "1"), page)
      if (Option.isNone(contents)) throw new Error("expected comments")
      expect(contents.value.comments.map((c) => c.id)).toEqual(["13", "12", "11", "122", "121"])
      // The reply edges survive the reordering — 122 and 121 still hang off 12.
      expect(contents.value.comments.map((c) => c.parentId)).toEqual([null, null, null, "12", "12"])
    })

    it("keeps Algolia's order when the page will not say, rather than losing the Discussion", async () => {
      const { contents } = await read(idOf("hackernews", "1"), (url) =>
        url.startsWith("https://news.ycombinator.com/")
          ? { status: 503, body: "down", headers: { "content-type": "text/html" } }
          : tree)
      if (Option.isNone(contents)) throw new Error("expected comments")
      expect(contents.value.comments.map((c) => c.id)).toEqual(["11", "12", "13", "121", "122"])
    })

    it("trails a comment the page did not show behind its ranked siblings", async () => {
      // A thread deep enough to paginate: id 11 is on page two, so the page we
      // fetched never mentions it. It must not jump the queue — and must not
      // vanish either.
      const { contents } = await read(idOf("hackernews", "1"), (url) =>
        url.startsWith("https://news.ycombinator.com/")
          ? {
            status: 200,
            headers: { "content-type": "text/html" },
            body: "<tr class='athing comtr' id='13'>\n<tr class='athing comtr' id='12'>"
          }
          : tree)
      if (Option.isNone(contents)) throw new Error("expected comments")
      expect(contents.value.comments.slice(0, 3).map((c) => c.id)).toEqual(["13", "12", "11"])
    })

    it("feeds the Digest's selection in this order — the producer piped into the consumer", async () => {
      // The genuinely end-to-end version of the contract the digest package
      // documents with a pre-arranged fixture: the REAL seam (Algolia tree +
      // page order, through `commentsUnder`'s breadth-first walk) produces the
      // comments, and the REAL `selectComments` consumes them. All scores are
      // null — the Hacker News case — so selection order IS input order, and
      // input order is the seam's: page-ranked roots first, then replies.
      const { contents } = await read(idOf("hackernews", "1"), page)
      if (Option.isNone(contents)) throw new Error("expected comments")
      const selected = selectComments(contents.value.comments, defaultLimits)
      expect(selected.map((c) => c.id)).toEqual(["13", "12", "11", "122", "121"])
    })

    it("scans both attribute spellings Hacker News has emitted", () => {
      // The live page answered double quotes on 2026-08-20; years of archived
      // pages carry single quotes. A quoting change must degrade to Algolia's
      // order, never to a crash — and better than degrade, it should just work.
      const single = ReadComments.pageRankOf("<tr class='athing comtr' id='7'>")
      const double = ReadComments.pageRankOf("<tr class=\"athing comtr\" id=\"7\">")
      expect([...single.entries()]).toEqual([["7", 0]])
      expect([...double.entries()]).toEqual([["7", 0]])
      // The submission row is not a comment and must not take rank 0.
      const withStory = ReadComments.pageRankOf(
        "<tr class=\"athing submission\" id=\"1\">\n<tr class=\"athing comtr\" id=\"9\">"
      )
      expect([...withStory.entries()]).toEqual([["9", 0]])
    })

    it("ranks the rows a reader collapsed, which carry extra classes", () => {
      // Measured on a live thread: 131 comment rows, of which one was
      // `athing comtr coll` (a collapsed thread) and three were
      // `athing comtr noshow` (its hidden children). A scan that required the
      // bare spelling sent exactly those four to the back in oldest-first
      // order — the bug, for the rows a reader had merely folded.
      const folded = ReadComments.pageRankOf([
        "<tr class=\"athing comtr coll\" id=\"5\">",
        "<tr class=\"athing comtr noshow\" id=\"6\">",
        "<tr class=\"athing comtr\" id=\"7\">"
      ].join("\n"))
      expect([...folded.entries()]).toEqual([["5", 0], ["6", 1], ["7", 2]])
      // And a class that merely BEGINS with "comtr" is a different class, not
      // a comment row.
      const imposter = ReadComments.pageRankOf("<tr class=\"athing comtrX\" id=\"8\">")
      expect(imposter.size).toBe(0)
    })
  })
})

describe("Reddit", () => {
  const thread = json(JSON.stringify([
    { kind: "Listing", data: { children: [{ data: { title: "A post", score: 91, num_comments: 40 } }] } },
    {
      kind: "Listing",
      data: {
        children: [
          {
            kind: "t1",
            data: {
              id: "abc",
              author: "someone",
              score: 30,
              body: "The top comment",
              // Reddit's own spelling of "no replies", and the single most
              // common reason a strict schema fails on a real thread.
              replies: ""
            }
          },
          {
            kind: "t1",
            data: {
              id: "def",
              author: "another",
              score: 4,
              body: "A reply's parent",
              replies: {
                kind: "Listing",
                data: {
                  children: [
                    { kind: "t1", data: { id: "ghi", author: "third", score: 1, body: "Nested" } },
                    // A "load 47 more" placeholder: no text, and following it
                    // is a second request per node.
                    { kind: "more", data: { id: "jkl" } }
                  ]
                }
              }
            }
          }
        ]
      }
    }
  ]))

  it("reads the post's own numbers and the whole comment tree", async () => {
    const { contents, asked } = await read(idOf("reddit", "1abc2de"), () => thread)
    if (Option.isNone(contents)) throw new Error("expected comments")
    // No `sort` parameter, deliberately: unsorted, Reddit answers in the
    // post's own default order — the order the thread shows a reader who
    // clicks through. `sort=top` was measurably a different conversation.
    expect(asked).toEqual(["https://www.reddit.com/comments/1abc2de.json?raw_json=1&limit=200"])
    expect(contents.value.title).toBe("A post")
    expect(contents.value.score).toBe(91)
    expect(contents.value.commentCount).toBe(40)
    expect(contents.value.comments.map((c) => c.id)).toEqual(["abc", "def", "ghi"])
    expect(contents.value.comments.map((c) => [c.parentId, c.depth])).toEqual([
      [null, 0],
      [null, 0],
      ["def", 1]
    ])
  })

  it("costs one Discussion rather than the Digest when Reddit refuses", async () => {
    // ADR 0013's ordinary path from most addresses, not an edge case.
    const { contents } = await read(idOf("reddit", "1abc2de"), () => ({
      status: 403,
      body: "<html>blocked</html>",
      headers: { "content-type": "text/html" }
    }))
    expect(Option.isNone(contents)).toBe(true)
  })
})

describe("what cannot happen", () => {
  it("returns nothing for a body that is not JSON at all", async () => {
    const { contents } = await read(idOf("hackernews", "1"), () => ({
      status: 200,
      body: "<html>an interstitial served as success</html>",
      headers: { "content-type": "text/html" }
    }))
    expect(Option.isNone(contents)).toBe(true)
  })

  it("asks nobody about X, whose Lookups are compiled out of this build", async () => {
    const { contents, asked } = await read(idOf("x", "1"), () => json("{}"))
    expect(Option.isNone(contents)).toBe(true)
    expect(asked).toEqual([])
  })
})

describe("turning markup into text", () => {
  it("keeps paragraph breaks and drops the tags", () => {
    expect(ReadComments.plainTextOf("<p>One</p><p>Two</p>")).toBe("One\n\nTwo")
  })

  it("decodes the entities Hacker News actually emits", () => {
    expect(ReadComments.plainTextOf("&quot;quoted&quot; &#x27;and&#x27; a&#x2F;b &gt; c")).toBe(
      "\"quoted\" 'and' a/b > c"
    )
  })

  it("gives back the literal entity an author escaped, not the character", () => {
    // `&amp;lt;` is somebody writing `&lt;` on purpose. Decoding `&amp;` first
    // would turn it into `<` and silently rewrite their comment.
    expect(ReadComments.plainTextOf("<p>write &amp;lt; for less-than</p>")).toBe(
      "write &lt; for less-than"
    )
  })
})
