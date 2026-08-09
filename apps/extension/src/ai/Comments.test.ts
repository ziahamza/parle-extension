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
    expect(asked).toEqual(["https://hn.algolia.com/api/v1/items/1"])
    if (Option.isNone(contents)) throw new Error("expected comments")
    expect(contents.value.title).toBe("A thread")
    expect(contents.value.score).toBe(640)
    expect(contents.value.comments.map((c) => c.id)).toEqual(["11", "13"])
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
    const { contents } = await read(idOf("hackernews", "1"), () => empty)
    // A Brief of a title with no conversation under it is a model summarising
    // a title, which is the one output ADR 0006 calls a bug.
    expect(Option.isNone(contents)).toBe(true)
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
    const { contents } = await read(idOf("reddit", "1abc2de"), () => thread)
    if (Option.isNone(contents)) throw new Error("expected comments")
    expect(contents.value.title).toBe("A post")
    expect(contents.value.score).toBe(91)
    expect(contents.value.commentCount).toBe(40)
    expect(contents.value.comments.map((c) => c.id)).toEqual(["abc", "def", "ghi"])
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
