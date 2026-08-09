/**
 * The ways a fabricating model gets through by producing LESS, not more.
 *
 * `Digests.test.ts` covers the fabrications that require the model to invent
 * something — a Discussion the Brief never held, a comment id inside a real
 * Discussion, a Reddit permalink colliding with a Hacker News item. Every one of
 * those is caught, and every one of them is a model reaching for a value it does
 * not have.
 *
 * These are the other direction, and they are the ones that survived review
 * three times: a citation check is satisfied by leaving a field OUT. The
 * strongest claim the product makes — ADR 0006's contested flag — was the one it
 * asked the least of, because `comment` is `optionalKey` and a Finding that
 * omitted it skipped the comment check entirely while still decoding perfectly.
 * A model with a real Discussion id from the prompt and nothing else could
 * therefore produce "this paper's central claim is disputed", attached to a live
 * thread, sourced to nothing. That is the failure the domain's own header
 * describes, arrived at from the opposite side.
 *
 * Every test here uses a Provider double wired the way the SHIPPED layers are —
 * `keepWhatArrived` applied inside `chat` — because that, not a bare stream, is
 * the contract this package actually consumes.
 */
import { describe, expect, it } from "vitest"
import { DiscussionId, type NativeId, type Network } from "@parle/domain/Network"
import type { SubjectUrl } from "@parle/domain/Subject"
import { type Chunk, keepWhatArrived, Provider, ProviderUnavailable } from "@parle/provider/Provider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import type { Brief } from "./Brief.ts"
import { layerOf } from "./Brief.ts"
import { digest } from "./Digests.ts"
import { instruction } from "./Prompt.ts"
import { watermarkOf } from "./Watermark.ts"

const subject = "https://example.com/a" as SubjectUrl

const on = (network: Network, nativeId: string): DiscussionId =>
  DiscussionId.make({ network, nativeId: nativeId as NativeId })

const hn = on("hackernews", "41293011")

const material: Brief = {
  subject,
  selected: [{
    discussion: hn,
    title: "A benchmark of the thing",
    score: 412,
    commentCount: 233,
    comments: [
      { id: "c1", author: "alice", score: 180, text: "This matches what we measured." },
      { id: "c2", author: "bob", score: 88, text: "This is misleading — warmed cache." }
    ]
  }],
  watermark: watermarkOf([{ discussion: hn, score: 412, comments: 233 }])
}

const findingText = (
  statement: string,
  citation: { network: string; nativeId: string; comment?: string },
  contested = false
): string =>
  JSON.stringify({
    statement,
    contested,
    citations: [{
      discussion: { network: citation.network, nativeId: citation.nativeId },
      ...(citation.comment === undefined ? {} : { comment: citation.comment })
    }]
  })

const good = findingText("Commenters reported the same measurements.", {
  network: "hackernews",
  nativeId: "41293011",
  comment: "c1"
})

/**
 * A Provider wired the way every shipped layer is wired.
 *
 * `chat` reports failure honestly. It used to apply `keepWhatArrived` inside
 * Byok, Codex and OnDevice, which erased the difference between "the model
 * finished" and "the model was cut off after a complete line" before this
 * package could see it. That was fixed at the seam; salvaging a partial answer
 * is now this package's decision, which is the only place it can be made.
 */
const shipped = (
  chunks: ReadonlyArray<string>,
  dies?: ProviderUnavailable
): Layer.Layer<Provider> =>
  Layer.succeed(
    Provider,
    Provider.of({
      id: "fake",
      model: "test-model",
      chat: (): Stream.Stream<Chunk, ProviderUnavailable> =>
        dies === undefined
          ? Stream.fromIterable(chunks)
          : Stream.concat(Stream.fromIterable(chunks), Stream.fail(dies))
    })
  )

const run = (layer: Layer.Layer<Provider>, of: Brief = material) =>
  Effect.runPromise(
    Effect.result(digest(of).pipe(Effect.provide(Layer.mergeAll(layer, layerOf(of)))))
  )

describe("a contested flag has to point at something the reader can read", () => {
  const contestedCiting = (comment?: string) =>
    findingText(
      "The benchmark's central claim is disputed.",
      { network: "hackernews", nativeId: "41293011", ...(comment === undefined ? {} : { comment }) },
      true
    )

  it("rejects a contested Finding whose only Citation is a whole Discussion", async () => {
    // Everything about this Finding is true: the Discussion is in the Brief, the
    // decode passes, `admit` is satisfied. It is still unciteable in the sense
    // ADR 0006 means — "the reader can go and judge the objection themselves" is
    // not served by a link to 233 comments — and it is the shape a model with
    // nothing but the prompt in front of it can always produce.
    const out = await run(shipped([`${good}\n${contestedCiting()}\n`]))
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(1)
    expect(out.success.findings[0].contested).toBe(false)
    expect(out.success.completeness).toBe("partial")
  })

  it("accepts the same contested Finding once it names the comment", async () => {
    const out = await run(shipped([contestedCiting("c2")]))
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings[0].contested).toBe(true)
    expect(out.success.completeness).toBe("complete")
  })

  it("still lets an uncontested Finding describe a Discussion as a whole", async () => {
    // The guard is on the judgement, not on citation shape. Summarising a thread
    // is exactly what a whole-Discussion Citation is for.
    const out = await run(
      shipped([findingText("The thread was broadly positive.", {
        network: "hackernews",
        nativeId: "41293011"
      })])
    )
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.completeness).toBe("complete")
  })

  it("asks for the comment id in the instruction it enforces", () => {
    // A guard the prompt does not ask for is a guard that only ever discards
    // work the reader paid for.
    expect(instruction).toContain("contested is true you MUST cite the id of the comment")
  })
})

describe("a Citation field left empty is not a Citation left out", () => {
  it("rejects an empty comment id rather than reading it as the whole Discussion", async () => {
    // `"comment": ""` is the prompt's own example field with nothing put in it.
    // Keyed as "no comment" it silently became a valid whole-Discussion pointer;
    // no Network issues an empty comment id, so it resolves to nothing.
    const out = await run(
      shipped([findingText("Someone said so.", {
        network: "hackernews",
        nativeId: "41293011",
        comment: ""
      })])
    )
    expect(Result.isFailure(out)).toBe(true)
    if (Result.isSuccess(out)) return
    expect(out.failure.reason).toBe("nothing-citeable")
  })

  it("rejects a perfectly cited Finding that says nothing", async () => {
    const out = await run(
      shipped([
        `${good}\n`,
        findingText("   ", { network: "hackernews", nativeId: "41293011", comment: "c2" })
      ])
    )
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(1)
    expect(out.success.completeness).toBe("partial")
  })

  it("rejects a statement made only of characters that draw nothing", async () => {
    // The third instance of this shape, and the one that survived the first
    // two. `trim()` removes Unicode White_Space and nothing else, so a
    // statement of `U+200B` — general category `Cf`, not whitespace — was not
    // blank, decoded, held up, and rendered as an empty line with a real
    // citation under it. The invariant was satisfied by writing one character
    // instead of none.
    for (const invisible of ["​", "‍‍", "﻿", "­", "⁠ \n\t"]) {
      const out = await run(
        shipped([findingText(invisible, {
          network: "hackernews",
          nativeId: "41293011",
          comment: "c2"
        })])
      )
      expect(Result.isFailure(out), JSON.stringify(invisible)).toBe(true)
    }
  })

  it("rejects it hardest when it is the contested one", async () => {
    // The panel prints "Someone in these discussions disagreed with this" above
    // the statement. An invisible statement makes that heading the whole of the
    // Finding: the product's strongest claim, attached to no claim at all.
    const out = await run(
      shipped([
        `${good}\n`,
        findingText("​", { network: "hackernews", nativeId: "41293011", comment: "c2" }, true)
      ])
    )
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(1)
    expect(out.success.findings[0].contested).toBe(false)
    expect(out.success.completeness).toBe("partial")
  })

  it("still keeps a statement whose only oddity is an invisible character inside it", () => {
    // The guard is "draws nothing at all", never "contains a format character".
    // Soft hyphens and joiners appear inside perfectly ordinary prose, and a
    // check that dropped those would discard real Findings the reader paid for.
    return run(
      shipped([findingText(
        "The bench­mark was re-run.",
        { network: "hackernews", nativeId: "41293011", comment: "c1" }
      )])
    ).then((out) => {
      expect(Result.isSuccess(out)).toBe(true)
      if (Result.isFailure(out)) return
      expect(out.success.findings).toHaveLength(1)
    })
  })
})

describe("formatting mistakes must not read as citation mistakes", () => {
  it("reads Findings out of a wrapping object, not just a wrapping array", async () => {
    // The single most common thing a model told "one JSON object per line" does.
    // The scanner cannot see through it — emitting nested objects would turn
    // every `citations` array into junk candidates — so it is opened where a
    // candidate is already known to be a Finding or not. Before this, the whole
    // answer was lost AND the reader was told nothing could be cited.
    const second = findingText("One commenter disputed the methodology.", {
      network: "hackernews",
      nativeId: "41293011",
      comment: "c2"
    })
    const out = await run(shipped([`{"findings": [${good}, ${second}]}`]))
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(2)
  })

  it("does not mistake a Finding for a wrapper", async () => {
    const out = await run(shipped([good]))
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(1)
  })
})

describe("what the reader is told when there was no answer", () => {
  it("does not blame the citation check for a Provider that said nothing at all", async () => {
    // `nothing-citeable` reads as "your model wrote output we could not use".
    // A Provider that completed without a single Chunk wrote nothing to use, and
    // telling the reader otherwise is blame in the wrong place and the wrong
    // offer to make them.
    const out = await run(shipped([]))
    expect(Result.isFailure(out)).toBe(true)
    if (Result.isSuccess(out)) return
    expect(out.failure.reason).toBe("provider-unavailable")
    expect(out.failure.providerReason).toBe("could-not-answer")
  })

  it("still says nothing-citeable when the Provider spoke and none of it held up", async () => {
    const out = await run(shipped(["I'm sorry, I can't help with that.\n"]))
    expect(Result.isFailure(out)).toBe(true)
    if (Result.isSuccess(out)) return
    expect(out.failure.reason).toBe("nothing-citeable")
  })
})

describe("a Brief assembled by hand rather than by brief()", () => {
  it("refuses a Brief of titles with no comments under them, without asking", async () => {
    // `Brief` is a plain interface with no codec, so nothing but this stops a
    // caller assembling one. A model handed titles alone will summarise the
    // title, and the result would be perfectly cited.
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
    const titlesOnly: Brief = {
      subject,
      selected: [{ discussion: hn, title: "A benchmark", score: 1, commentCount: 233, comments: [] }],
      watermark: watermarkOf([])
    }
    const out = await run(counting, titlesOnly)
    expect(Result.isFailure(out)).toBe(true)
    if (Result.isSuccess(out)) return
    expect(out.failure.reason).toBe("nothing-to-summarise")
    expect(asked).toBe(0)
  })
})

describe("what this package cannot see, and must not claim to", () => {
  it("detects a mid-answer death that lands inside an object", async () => {
    const out = await run(
      shipped(
        [`${good}\n`, `{"statement":"the second half of a sen`],
        new ProviderUnavailable({ reason: "unreachable", detail: "socket closed" })
      )
    )
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.completeness).toBe("partial")
  })

  it("records a death on a clean object boundary as partial", async () => {
    // This was pinned as a KNOWN GAP asserting "complete", because every shipped
    // `chat` applied `keepWhatArrived` and a mid-stream failure reached this
    // package as an ordinary end of stream — so a truncated answer was recorded
    // as whole. The seam now reports the failure and this reads correctly.
    //
    // The hard case: the death lands BETWEEN objects, so nothing is malformed
    // and the scanner sees nothing wrong. Only the error channel knows.
    const out = await run(
      shipped(
        [`${good}\n`],
        new ProviderUnavailable({ reason: "rate-limited", detail: "429 mid-answer" })
      )
    )
    expect(Result.isSuccess(out)).toBe(true)
    if (Result.isFailure(out)) return
    expect(out.success.findings).toHaveLength(1)
    expect(out.success.completeness).toBe("partial")
  })
})
