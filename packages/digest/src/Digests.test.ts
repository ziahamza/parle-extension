/**
 * The two things this package must be able to survive, end to end.
 *
 * One is a Provider that stops mid-sentence. ~1800 tokens arrive, one valid
 * Finding plus a truncated second, and the naive consumer parses the document,
 * throws at position 343, and discards everything — including the Finding the
 * reader already paid for out of their own subscription. Here that must be one
 * Finding and a `partial` Digest.
 *
 * The other is a Provider that fabricates. ADR 0006's contested flag is the
 * product's highest-trust surface, and three of four independently-designed
 * models had a version of the invariant that a fabricating model satisfied by
 * hallucinating slightly more. Here a fabricated Citation must be rejected all
 * the way through, including one that names a real Discussion and invents a
 * comment inside it.
 */
import { describe, expect, it } from "vitest"
import { admit, Brief as BriefService } from "@parle/domain/Digest"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, discussionKey, NativeId, type Network } from "@parle/domain/Network"
import { SubjectUrl } from "@parle/domain/Subject"
import { type Chunk, Provider, ProviderUnavailable } from "@parle/provider/Provider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import type { Brief, Contents } from "./Brief.ts"
import { layerOf } from "./Brief.ts"
import { Comments } from "./Comments.ts"
import { brief, digest, Digests, write } from "./Digests.ts"
import { watermarkOf } from "./Watermark.ts"

const subject = SubjectUrl.make("https://example.com/a")

const on = (network: Network, nativeId: string): DiscussionId =>
  DiscussionId.make({ network, nativeId: NativeId.make(nativeId) })

const hn = on("hackernews", "41293011")
const rd = on("reddit", "1abc2de")

const material: Brief = {
  subject,
  selected: [
    {
      discussion: hn,
      title: "A benchmark of the thing",
      score: 412,
      commentCount: 233,
      comments: [
        { id: "c1", author: "alice", score: 180, text: "This matches what we measured." },
        { id: "c2", author: "bob", score: 88, text: "This is misleading — warmed cache." }
      ]
    }
  ],
  watermark: watermarkOf([{ discussion: hn, score: 412, comments: 233 }])
}

/** One Finding, as the Provider is asked to spell it. */
const findingText = (
  statement: string,
  citation: { network: string; nativeId: string; comment?: string }
): string =>
  JSON.stringify({
    statement,
    contested: false,
    citations: [
      citation.comment === undefined
        ? { discussion: { network: citation.network, nativeId: citation.nativeId } }
        : { discussion: { network: citation.network, nativeId: citation.nativeId }, comment: citation.comment }
    ]
  })

const good = findingText("Commenters reported the same measurements.", {
  network: "hackernews",
  nativeId: "41293011",
  comment: "c1"
})

/**
 * A Provider that says exactly these chunks, then optionally dies.
 *
 * Deliberately RAW: it does not apply `keepWhatArrived`, which every shipped
 * layer applies inside `chat`. That makes it the double for a Provider whose
 * mid-stream failure still reaches this package — not the double for the shipped
 * contract, under which the failure has already been converted to a normal end
 * of stream. `Fabrication.test.ts` uses the shipped wiring, and pins what this
 * package can and cannot see once it is in place.
 */
const providerOf = (
  chunks: ReadonlyArray<string>,
  dies?: ProviderUnavailable
): Layer.Layer<Provider> =>
  Layer.succeed(
    Provider,
    Provider.of({
      id: "fake",
      model: "test-model",
      chat: (): Stream.Stream<Chunk, ProviderUnavailable> => {
        const spoken = Stream.fromIterable(chunks)
        return dies === undefined ? spoken : Stream.concat(spoken, Stream.fail(dies))
      }
    })
  )

const runDigest = (chunks: ReadonlyArray<string>, dies?: ProviderUnavailable, of = material) =>
  Effect.runPromise(
    Effect.result(
      digest(of).pipe(Effect.provide(Layer.mergeAll(providerOf(chunks, dies), layerOf(of))))
    )
  )

describe("a Provider that stops mid-sentence", () => {
  it("yields the Findings that arrived, and marks the Digest partial", async () => {
    const out = await runDigest([`${good}\n`, `{"statement":"the second half of a sen`])
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(1)
    expect(out.success.findings[0].statement).toBe("Commenters reported the same measurements.")
    expect(out.success.completeness).toBe("partial")
  })

  it("marks it partial when a Provider that surfaces its failure dies mid-answer", async () => {
    const out = await runDigest(
      [`${good}\n`],
      new ProviderUnavailable({ reason: "rate-limited", detail: "429 mid-answer" })
    )
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(1)
    expect(out.success.completeness).toBe("partial")
  })

  it("marks it complete when nothing went wrong", async () => {
    const second = findingText("One commenter disputed the methodology.", {
      network: "hackernews",
      nativeId: "41293011",
      comment: "c2"
    })
    const out = await runDigest([`${good}\n${second}\n`])
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(2)
    expect(out.success.completeness).toBe("complete")
  })

  it("refuses, rather than partially succeeding, when the Provider never spoke", async () => {
    const out = await runDigest(
      [],
      new ProviderUnavailable({ reason: "not-connected", detail: "nothing connected" })
    )
    expect(Result.isFailure(out)).toBe(true)
    if (Result.isSuccess(out)) return
    expect(out.failure.reason).toBe("provider-unavailable")
    expect(out.failure.providerReason).toBe("not-connected")
  })
})

describe("a Provider that fabricates", () => {
  it("rejects a Citation naming a Discussion the Brief never held", async () => {
    const invented = findingText("A Reddit thread called it a fraud.", {
      network: "reddit",
      nativeId: "t3_9zzzzz",
      comment: "x1"
    })
    const out = await runDigest([`${good}\n${invented}\n`])
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(1)
    expect(out.success.findings[0].statement).not.toContain("fraud")
    expect(out.success.completeness).toBe("partial")
  })

  it("rejects a cross-Network id collision", async () => {
    // A Reddit permalink whose base-36 id equals the Hacker News item id in the
    // Brief. Keyed on the bare id this is accepted; keyed on the pair it is not.
    const collided = findingText("Reddit said otherwise.", {
      network: "reddit",
      nativeId: "41293011",
      comment: "c1"
    })
    const out = await runDigest([`${collided}\n`])
    expect(Result.isFailure(out)).toBe(true)
    if (Result.isSuccess(out)) return
    expect(out.failure.reason).toBe("nothing-citeable")
  })

  it("rejects a real Discussion with an invented comment inside it", async () => {
    const halfInvented = findingText("Someone posted a retraction.", {
      network: "hackernews",
      nativeId: "41293011",
      comment: "c99"
    })
    const out = await runDigest([`${good}\n${halfInvented}\n`])
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(1)
    expect(out.success.completeness).toBe("partial")
  })

  it("refuses outright when not one Finding could be cited", async () => {
    const out = await runDigest([
      findingText("Everyone agrees.", { network: "reddit", nativeId: "t3_9zzzzz" })
    ])
    expect(Result.isFailure(out)).toBe(true)
    if (Result.isSuccess(out)) return
    expect(out.failure.reason).toBe("nothing-citeable")
  })

  it("rejects a Finding with no Citation at all", async () => {
    const uncited = JSON.stringify({ statement: "Everyone agrees.", contested: false, citations: [] })
    const out = await runDigest([uncited])
    expect(Result.isFailure(out)).toBe(true)
  })

  it("drops an object that is not a Finding without losing the ones that are", async () => {
    const out = await runDigest([`{"thinking":"let me consider"}\n${good}\n`])
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(1)
  })
})

describe("what a Digest records about itself", () => {
  it("stamps the Provider that wrote it, as Local", async () => {
    const out = await runDigest([good])
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.origin).toEqual({ _tag: "Local", providerId: "fake", model: "test-model" })
  })

  it("is a Digest of the Brief's Subject", async () => {
    const out = await runDigest([good])
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.subject).toBe(subject)
  })
})

describe("a Brief with nothing in it", () => {
  const empty: Brief = { subject, selected: [], watermark: watermarkOf([]) }

  it("refuses without asking the Provider anything", async () => {
    let asked = 0
    const counting = Layer.succeed(
      Provider,
      Provider.of({
        id: "fake",
        model: "test-model",
        chat: (): Stream.Stream<Chunk, ProviderUnavailable> => {
          asked += 1
          return Stream.empty
        }
      })
    )
    const out = await Effect.runPromise(
      Effect.result(digest(empty).pipe(Effect.provide(Layer.mergeAll(counting, layerOf(empty)))))
    )
    expect(Result.isFailure(out)).toBe(true)
    if (Result.isSuccess(out)) return
    expect(out.failure.reason).toBe("nothing-to-summarise")
    expect(asked).toBe(0)
  })
})

describe("write, as a panel consumes it", () => {
  it("streams the Findings and nothing else", async () => {
    const findings = await Effect.runPromise(
      Stream.runCollect(write(material)).pipe(
        Effect.provide(Layer.mergeAll(providerOf([`${good}\n{"broken`]), layerOf(material)))
      )
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.citations[0].discussion.nativeId).toBe("41293011")
  })
})

describe("the door stays the only door", () => {
  it("re-exports @parle/domain's admit rather than reimplementing it", () => {
    // Literally the same function, so the Shared Digest's bytes and the
    // Provider's output are checked by one implementation that cannot drift
    // into two versions the way a server-side-only check would.
    const digests = Effect.runSync(Digests.pipe(Effect.provide(Digests.layer)))
    expect(digests.admit).toBe(admit)
  })

  it("rejects a Digest assembled anywhere else that cites outside the Brief", async () => {
    const out = Effect.runSync(
      Effect.result(
        admit({
          subject,
          origin: { _tag: "Local", providerId: "fake", model: "test-model" },
          completeness: "complete",
          findings: [{
            statement: "Fabricated.",
            contested: true,
            citations: [{ discussion: { network: "reddit", nativeId: "t3_9zzzzz" } }]
          }]
        }).pipe(Effect.provideService(BriefService, {
          subject,
          contains: (id) => discussionKey(id) === discussionKey(hn)
        }))
      )
    )
    expect(Result.isFailure(out)).toBe(true)
  })
})

describe("building the Brief", () => {
  const contentsOf = (title: string, comments: number): Contents => ({
    title,
    score: 100,
    commentCount: comments,
    comments: Array.from({ length: comments }, (_, i) => ({
      id: `c${i}`,
      author: "someone",
      score: 50 - i,
      text: i === comments - 1 ? "This is misleading." : "Broadly agreed."
    }))
  })

  const linkedTo = (discussion: DiscussionId) =>
    Mention.cases.Linked.make({
      subject,
      discussion,
      viaAlias: "https://example.com/a"
    })

  const held = new Map<string, Contents>([
    [discussionKey(hn), contentsOf("On Hacker News", 40)],
    [discussionKey(rd), contentsOf("On Reddit", 5)]
  ])

  const runBrief = (mentions: ReadonlyArray<ReturnType<typeof linkedTo>>) =>
    Effect.runPromise(
      brief(subject, mentions).pipe(Effect.provide(Comments.layerOf(held)))
    )

  it("takes both Networks, not just the bigger one", async () => {
    const built = await runBrief([linkedTo(hn), linkedTo(rd)])
    expect(built.selected.map((s) => s.discussion.network)).toEqual(["hackernews", "reddit"])
  })

  it("bounds what reaches the model", async () => {
    const built = await runBrief([linkedTo(hn)])
    expect(built.selected[0]?.comments.length).toBeLessThanOrEqual(12)
  })

  it("takes a Watermark of what it selected", async () => {
    const built = await runBrief([linkedTo(hn), linkedTo(rd)])
    expect(built.watermark.marks).toHaveLength(2)
    expect(built.watermark.marks[0]?.comments).toBe(40)
  })

  it("does not repeat a Discussion mentioned twice", async () => {
    const built = await runBrief([linkedTo(hn), linkedTo(hn)])
    expect(built.selected).toHaveLength(1)
  })

  it("leaves out a Discussion whose comments could not be read", async () => {
    const built = await Effect.runPromise(
      brief(subject, [linkedTo(hn)]).pipe(Effect.provide(Comments.layerEmpty))
    )
    expect(built.selected).toEqual([])
  })

  it("produces a Brief whose service admits exactly what it holds", async () => {
    const built = await runBrief([linkedTo(hn)])
    const service = layerOf(built)
    const out = Effect.runSync(
      Effect.result(
        admit({
          subject,
          origin: { _tag: "Local", providerId: "fake", model: "m" },
          completeness: "complete",
          findings: [{
            statement: "Reported.",
            contested: false,
            citations: [{ discussion: { network: "hackernews", nativeId: "41293011" } }]
          }]
        }).pipe(Effect.provide(service))
      )
    )
    expect(Result.isSuccess(out)).toBe(true)
  })
})
