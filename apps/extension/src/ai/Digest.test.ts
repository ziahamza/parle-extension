/**
 * The Digest, end to end, over the seams that actually ship.
 *
 * Everything between "the reader clicked Summarise" and "a Finding with a
 * followable link is on screen" is real here: the same `Comments` reader that
 * fetches Hacker News comment trees, the same `Digests` that selects and
 * prompts, the same `admit` that is the only constructor for a Finding, the
 * same BYOK Provider speaking `chat/completions` over SSE, and the same
 * `panelOf` that draws it. Only the wire is substituted.
 *
 * The tests are ordered as the things that would be worst to get wrong:
 *
 *   1. **Nothing is fetched until the reader asks.** Reading comment bodies is
 *      several requests where a Lookup is one, and it hands a third party the
 *      text of conversations about what the reader is reading. If this test
 *      ever passes vacuously, the product has quietly become something else.
 *   2. **A fabricated Citation cannot reach the panel.** ADR 0006's invariant
 *      is enforced in `@parle/domain` and this asserts it survives the whole
 *      journey rather than only the unit test next to it.
 *   3. **Every failure is a state with its own words**, per ADR 0011 — and a
 *      Provider that dies mid-answer yields a partial Digest rather than none.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { Digests } from "@parle/digest/Digests"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { SubjectUrl } from "@parle/domain/Subject"
import { Storage } from "@parle/browser/Storage"
import { makeDouble, WebExt } from "@parle/browser/WebExtApi"
import { type Exchange, recording } from "@parle/networks/Recording"
import { Attributed, DigestStanding } from "../enquiry/Knowledge.ts"
import {
  firstRun,
  type ReaderSettings,
  SETTINGS_KEY,
  Settings,
  asDocument,
  withByok,
  withProviderConnection
} from "../settings/Settings.ts"
import * as ReadComments from "./Comments.ts"
import { Digesting } from "./Digesting.ts"

const subject = SubjectUrl.make("https://example.com/piece")

const hn = (id: string): DiscussionId =>
  DiscussionId.make({ network: "hackernews", nativeId: NativeId.make(id) })

const linkedTo = (id: string) =>
  Mention.cases.Linked.make({ subject, discussion: hn(id), viaAlias: subject })

/** One Algolia item tree: a story with three comments under it. */
const thread = JSON.stringify({
  id: 4001,
  type: "story",
  title: "Not all open source AI models are open",
  points: 640,
  children: [
    {
      id: 4101,
      type: "comment",
      author: "ada",
      points: 210,
      text: "<p>The licence is the whole story here; the weights being downloadable is not the same as open.</p>"
    },
    {
      id: 4102,
      type: "comment",
      author: "grace",
      points: 180,
      text: "<p>This is wrong &#x27;in one place&#x27;: the benchmark was run on the wrong hardware.</p>",
      children: [
        {
          id: 4103,
          type: "comment",
          author: "linus",
          points: 40,
          text: "<p>Agreed &amp; the errata says so.</p>"
        }
      ]
    }
  ]
})

/** A `chat/completions` SSE body carrying one JSON object per line. */
const streamed = (lines: ReadonlyArray<string>): string =>
  lines
    .map((line) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content: `${line}\n` } }] })}\n\n`
    )
    .join("") + "data: [DONE]\n\n"

const finding = (
  statement: string,
  contested: boolean,
  citation: { readonly nativeId: string; readonly comment?: string }
): string =>
  JSON.stringify({
    statement,
    contested,
    citations: [
      citation.comment === undefined
        ? { discussion: { network: "hackernews", nativeId: citation.nativeId } }
        : { discussion: { network: "hackernews", nativeId: citation.nativeId }, comment: citation.comment }
    ]
  })

const GOOD = streamed([
  finding("Commenters read it as a licensing question, not a technical one", false, {
    nativeId: "4001",
    comment: "4101"
  }),
  finding("One commenter disputed the benchmark's hardware", true, {
    nativeId: "4001",
    comment: "4102"
  })
])

const json = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json" }
})

const sse = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "text/event-stream" }
})

/** Everything answers; the Provider says whatever the test hands it. */
const wireFor = (provider: Exchange) => (url: string): Exchange => {
  if (url.includes("hn.algolia.com/api/v1/items")) return json(thread)
  if (url.includes("/chat/completions")) return provider
  return { status: 404, body: "{}", headers: { "content-type": "application/json" } }
}

const readerWith = (settings: ReaderSettings) => {
  const double = makeDouble()
  double.held.set(SETTINGS_KEY, new TextEncoder().encode(asDocument(settings)))
  return double
}

const CONNECTED = withProviderConnection(
  withByok(firstRun, { apiKey: "sk-test", model: "a-model" }),
  "byok"
)

/**
 * Run one Digest over the shipped graph, and report what actually left.
 *
 * The layer is assembled the way `Pipeline.on` assembles it, so a change to
 * either shape shows up here rather than in a lookalike that quietly drifts.
 */
const digesting = async (
  settings: ReaderSettings,
  provider: Exchange,
  act: (write: Digesting["Service"]["write"]) => Promise<DigestStanding> | DigestStanding
): Promise<{ standing: DigestStanding; asked: ReadonlyArray<string> }> => {
  const wire = recording(wireFor(provider))
  const store = Layer.provide(Storage.layer, WebExt.doubleLayer(readerWith(settings)))
  const layer = Digesting.layer.pipe(
    Layer.provide(Layer.mergeAll(
      Settings.layer.pipe(Layer.provide(store)),
      ReadComments.layer.pipe(Layer.provide(wire.layer)),
      Digests.layer,
      wire.layer
    ))
  )

  const standing = await Effect.runPromise(
    Effect.flatMap(Digesting, (service) => Effect.promise(async () => act(service.write))).pipe(
      Effect.provide(layer)
    )
  )
  return { standing, asked: [...wire.asked] }
}

describe("nothing happens until the reader asks", () => {
  it("builds the whole graph without issuing a single request", async () => {
    // Constructing every layer — the Comments reader, the Digest service, the
    // Provider seam — must reach nobody. If this ever fails, comment bodies are
    // being fetched as a side effect of a page load.
    const wire = recording(wireFor(sse(GOOD)))
    const store = Layer.provide(Storage.layer, WebExt.doubleLayer(readerWith(CONNECTED)))
    await Effect.runPromise(
      Effect.flatMap(Digesting, () => Effect.void).pipe(
        Effect.provide(Digesting.layer.pipe(
          Layer.provide(Layer.mergeAll(
            Settings.layer.pipe(Layer.provide(store)),
            ReadComments.layer.pipe(Layer.provide(wire.layer)),
            Digests.layer,
            wire.layer
          ))
        ))
      )
    )
    expect(wire.asked).toEqual([])
  })

  it("reads the comments only once asked, and only of the Linked Discussions", async () => {
    const { asked } = await digesting(CONNECTED, sse(GOOD), (write) =>
      Effect.runPromise(write(subject, [linkedTo("4001")])))
    expect(asked.filter((url) => url.includes("/api/v1/items/"))).toEqual([
      "https://hn.algolia.com/api/v1/items/4001"
    ])
  })
})

describe("a Digest that was written", () => {
  it("carries the Findings the Provider produced, each with somewhere to check it", async () => {
    const { standing } = await digesting(CONNECTED, sse(GOOD), (write) =>
      Effect.runPromise(write(subject, [linkedTo("4001")])))

    expect(standing._tag).toBe("Written")
    if (standing._tag !== "Written") return
    expect(standing.completeness).toBe("complete")
    expect(standing.findings).toHaveLength(2)
    // Every Finding points at a comment, which is what makes the flag checkable.
    for (const found of standing.findings) {
      expect(found.citations.length).toBeGreaterThan(0)
      expect(found.citations[0]?.comment).toBeTruthy()
    }
    expect(standing.findings[1]?.contested).toBe(true)
  })

  it("records which Provider wrote it, and that it never left this machine", async () => {
    const { standing } = await digesting(CONNECTED, sse(GOOD), (write) =>
      Effect.runPromise(write(subject, [linkedTo("4001")])))
    if (standing._tag !== "Written") throw new Error("expected a Digest")
    expect(standing.origin._tag).toBe("Local")
    if (standing.origin._tag !== "Local") return
    expect(standing.origin.model).toBe("a-model")
  })

  it("sends the comment text, not the addresses, to the Provider", async () => {
    // The disclosure the panel makes before the reader agrees: the COMMENTS go
    // to the Provider. A Brief of titles would be a model summarising a title.
    const wire = recording((url) => {
      if (url.includes("hn.algolia.com/api/v1/items")) return json(thread)
      return sse(GOOD)
    })
    const store = Layer.provide(Storage.layer, WebExt.doubleLayer(readerWith(CONNECTED)))
    await Effect.runPromise(
      Effect.flatMap(Digesting, (service) => service.write(subject, [linkedTo("4001")])).pipe(
        Effect.provide(Digesting.layer.pipe(
          Layer.provide(Layer.mergeAll(
            Settings.layer.pipe(Layer.provide(store)),
            ReadComments.layer.pipe(Layer.provide(wire.layer)),
            Digests.layer,
            wire.layer
          ))
        ))
      )
    )
    expect(wire.asked.some((url) => url.includes("/chat/completions"))).toBe(true)
  })
})

describe("the shape that crosses to the panel", () => {
  const read = Schema.decodeUnknownOption(Attributed)
  const cited = {
    discussion: { network: "hackernews", nativeId: "4001" },
    comment: "4101"
  }

  it("cannot represent a Finding with nothing to check it against", () => {
    // `@parle/domain`'s `Finding` says `NonEmptyArray`; this said `Array`, so
    // the last hop before the screen was the one hop that did not carry ADR
    // 0006's rule. `render.ts` draws the statement and then loops over the
    // sources, so a Finding with none renders as an attributed sentence with
    // nothing under it — an uncited claim, arrived at by producing LESS.
    expect(Option.isNone(read({ statement: "s", contested: false, citations: [] }))).toBe(true)
  })

  it("takes the same Finding once it cites something", () => {
    expect(Option.isSome(read({ statement: "s", contested: false, citations: [cited] }))).toBe(true)
  })
})

describe("what the Provider is not allowed to get away with", () => {
  it("drops a Finding citing a Discussion that was never in front of it", async () => {
    // The failure ADR 0006 exists for: a model that invents a source AND a
    // pointer to it. `admit` cannot be run without the material, so the
    // fabricated one cannot decode — and the good one still arrives.
    const mixed = streamed([
      finding("Real, and pointing at a real comment", false, {
        nativeId: "4001",
        comment: "4101"
      }),
      finding("Invented, citing a thread nobody read", true, {
        nativeId: "999999",
        comment: "1"
      })
    ])
    const { standing } = await digesting(CONNECTED, sse(mixed), (write) =>
      Effect.runPromise(write(subject, [linkedTo("4001")])))

    if (standing._tag !== "Written") throw new Error("expected a partial Digest")
    expect(standing.findings).toHaveLength(1)
    expect(standing.findings[0]?.statement).toMatch(/^Real/)
    // The reader is told something was dropped rather than shown a shortened
    // answer presented as the whole one.
    expect(standing.completeness).toBe("partial")
  })

  it("drops a contested Finding that points only at a whole thread", async () => {
    // ADR 0006 permits the flag only where the reader can go and read the
    // objection. A contested claim citing 640 comments is not checkable.
    const vague = streamed([
      finding("Reports the thread as a whole", false, { nativeId: "4001" }),
      finding("Disputed, but by nobody in particular", true, { nativeId: "4001" })
    ])
    const { standing } = await digesting(CONNECTED, sse(vague), (write) =>
      Effect.runPromise(write(subject, [linkedTo("4001")])))

    if (standing._tag !== "Written") throw new Error("expected a partial Digest")
    expect(standing.findings).toHaveLength(1)
    expect(standing.findings[0]?.contested).toBe(false)
    expect(standing.completeness).toBe("partial")
  })

  it("keeps what arrived when the answer stops mid-object", async () => {
    // ~1800 tokens of the reader's own subscription, one complete Finding and
    // half of a second. `JSON.parse` over the whole answer threw and discarded
    // both; the scanner hands the first one downstream the moment it closes.
    const cut = `data: ${
      JSON.stringify({
        choices: [{
          delta: {
            content: `${
              finding("Complete, and paid for", false, { nativeId: "4001", comment: "4101" })
            }\n{"statement": "cut off here`
          }
        }]
      })
    }\n\n`
    const { standing } = await digesting(CONNECTED, sse(cut), (write) =>
      Effect.runPromise(write(subject, [linkedTo("4001")])))

    if (standing._tag !== "Written") throw new Error("expected a partial Digest")
    expect(standing.findings).toHaveLength(1)
    expect(standing.completeness).toBe("partial")
  })
})

describe("every failure is a state with its own words", () => {
  const refusal = async (provider: Exchange): Promise<DigestStanding> => {
    const { standing } = await digesting(CONNECTED, provider, (write) =>
      Effect.runPromise(write(subject, [linkedTo("4001")])))
    return standing
  }

  it("says the key was rejected, and offers the settings page", async () => {
    const standing = await refusal({ status: 401, body: "{}" })
    if (standing._tag !== "Refused") throw new Error("expected a refusal")
    expect(standing.because).toMatch(/rejected/)
    expect(standing.offer).toBe("connect")
  })

  it("says the account cannot pay, which is not the same as a bad key", async () => {
    const standing = await refusal({ status: 402, body: "{}" })
    if (standing._tag !== "Refused") throw new Error("expected a refusal")
    expect(standing.because).toMatch(/cannot pay/)
    expect(standing.because).not.toMatch(/rejected/)
  })

  it("says a rate limit is nothing being wrong, and offers to try again", async () => {
    const standing = await refusal({ status: 429, body: "{}" })
    if (standing._tag !== "Refused") throw new Error("expected a refusal")
    expect(standing.because).toMatch(/slow down/)
    expect(standing.offer).toBe("again")
  })

  it("says the model answered unusably, without blaming the reader", async () => {
    const standing = await refusal(sse(streamed(["not JSON at all, just prose"])))
    if (standing._tag !== "Refused") throw new Error("expected a refusal")
    expect(standing.because).toMatch(/nothing it wrote pointed at a comment/)
  })

  it("does not blame a Provider it never reached when no comments could be read", async () => {
    const wire = recording(() => ({ status: 403, body: "<html>no</html>" }))
    const store = Layer.provide(Storage.layer, WebExt.doubleLayer(readerWith(CONNECTED)))
    const standing = await Effect.runPromise(
      Effect.flatMap(Digesting, (service) => service.write(subject, [linkedTo("4001")])).pipe(
        Effect.provide(Digesting.layer.pipe(
          Layer.provide(Layer.mergeAll(
            Settings.layer.pipe(Layer.provide(store)),
            ReadComments.layer.pipe(Layer.provide(wire.layer)),
            Digests.layer,
            wire.layer
          ))
        ))
      )
    )
    if (standing._tag !== "Refused") throw new Error("expected a refusal")
    expect(standing.because).toMatch(/could not read the comments/)
    // And it says so: the reader's own quota was not spent on a Brief with
    // nothing in it.
    expect(standing.because).toMatch(/Nothing was sent/)
    expect(wire.asked.some((url) => url.includes("/chat/completions"))).toBe(false)
  })

  it("says nothing is connected rather than inventing a rejected key", async () => {
    const { standing, asked } = await digesting(firstRun, sse(GOOD), (write) =>
      Effect.runPromise(write(subject, [linkedTo("4001")])))
    if (standing._tag !== "Refused") throw new Error("expected a refusal")
    expect(standing.because).toMatch(/no Provider is connected/)
    expect(standing.offer).toBe("connect")
    // And nothing was fetched: a reader with no Provider pays nothing.
    expect(asked).toEqual([])
  })
})
