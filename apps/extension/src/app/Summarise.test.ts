/**
 * The Digest through the graph as it actually ships, from a navigation to a
 * rendered Finding.
 *
 * `Pipeline.on` is the real thing — the same `Board`, the same `Enquiry`, the
 * same comment reader, the same Provider seam, the same `panelOf`. Only the
 * platform and the wire are substituted, which is the whole reason that function
 * takes them as arguments.
 *
 * The property this file exists for is the first test, and it is about traffic
 * rather than about output: **a page load must not fetch a single comment.**
 * Reading comment bodies is several requests where a Lookup is one, and it ends
 * with the text of those conversations at a third party. If it ever becomes a
 * consequence of opening a page, the product has quietly become something the
 * disclosure does not describe — and nothing else in the suite would notice.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { isSettled } from "@parle/domain/Coverage"
import { hackerNewsLinked, hackerNewsTopical } from "@parle/networks/Recorded"
import { type Exchange, recording } from "@parle/networks/Recording"
import { makeDouble, WebExt } from "@parle/browser/WebExtApi"
import { ReadingWatch } from "@parle/browser/ReadingWatch"
import { Board } from "../reading/Board.ts"
import type { Reading } from "../reading/Reading.ts"
import { everyNetworkOn, type Surroundings } from "../reading/Surroundings.ts"
import {
  firstRun,
  Settings,
  withAutomatic,
  withByok,
  withProviderConnection
} from "../settings/Settings.ts"
import { panelOf } from "../view/panelOf.ts"
import type { Panel } from "../view/Panel.ts"
import * as Pipeline from "./Pipeline.ts"

/** The page the recorded Algolia bodies are about. */
const ADDRESS = "https://www.nature.com/articles/d41586-024-02012-5"
const TITLE = "Not all 'open source' AI models are open"
const NOW = 1_800_000_000_000

const AGREED: Surroundings = {
  decision: "automatic",
  provider: { connected: true, name: "your own API key" },
  networks: everyNetworkOn,
  index: { _tag: "Absent" },
  everyDiscussion: false
}

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

/**
 * The thread the Digest cites, taken from the recorded Algolia body.
 *
 * `40786237` is the highest-scoring hit whose own submitted URL really matches
 * the page, so it is a Discussion the Lookup genuinely found rather than one
 * this test invented — which matters, because a Citation naming anything else
 * would be dropped by `admit` and the test would be asserting the fabrication
 * path by accident.
 *
 * The recorded body also carries `40802874`, submitted under a DIFFERENT
 * article, which the connector drops. It must never be summarised, and the last
 * test holds that.
 */
const ITEM_ID = "40786237"
const WRONG_ARTICLE_ID = "40802874"

const thread = JSON.stringify({
  id: Number(ITEM_ID),
  type: "story",
  title: TITLE,
  points: 640,
  children: [
    {
      id: 5001,
      type: "comment",
      author: "ada",
      points: 210,
      text: "<p>The licence is the whole story; downloadable weights are not open.</p>"
    },
    {
      id: 5002,
      type: "comment",
      author: "grace",
      points: 88,
      text: "<p>The ranking&#x27;s methodology is disputed by the authors it ranks.</p>"
    }
  ]
})

const answered = JSON.stringify({
  statement: "Commenters read the ranking as a licensing question rather than a technical one",
  contested: false,
  citations: [{ discussion: { network: "hackernews", nativeId: ITEM_ID }, comment: "5001" }]
})

const CHAT = `data: ${
  JSON.stringify({ choices: [{ delta: { content: `${answered}\n` } }] })
}\n\ndata: [DONE]\n\n`

/**
 * Algolia answers searches and comment trees; the Provider answers chat.
 *
 * Reddit 403s, exactly as it does live from here — which is also what makes the
 * Digest's tolerance of an unreadable Discussion real rather than asserted.
 */
const wire = (url: string): Exchange => {
  if (url.includes("hn.algolia.com/api/v1/items")) return json(thread)
  if (url.includes("/chat/completions")) return sse(CHAT)
  if (url.includes("hn.algolia.com")) {
    return json(url.includes("restrictSearchableAttributes") ? hackerNewsLinked : hackerNewsTopical)
  }
  return { status: 403, body: "<html>blocked</html>", headers: { "content-type": "text/html" } }
}

const connected = withProviderConnection(
  withByok(withAutomatic(firstRun, true), { apiKey: "sk-test", model: "a-model" }),
  "byok"
)

interface Run {
  readonly beforeAsking: Panel
  readonly afterAsking: Panel
  readonly askedBeforeSummarising: ReadonlyArray<string>
  readonly asked: ReadonlyArray<string>
}

/**
 * Load the page, read the panel, press Summarise, read it again.
 *
 * Waits on observable facts — Coverage settling, then the Digest leaving
 * `Ready` — rather than on durations, because a sleep long enough to be
 * reliable on a loaded machine is long enough to hide a hang.
 */
const readingAndSummarising = async (): Promise<Run> => {
  const double = makeDouble()
  const recorded = recording(wire)

  return await Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const watch = yield* ReadingWatch
      const board = yield* Board
      const settings = yield* Settings
      yield* settings.change(() => connected)

      const boundaries = yield* Effect.forkScoped(
        Stream.runForEach(watch.readings, (boundary) =>
          board.sight(boundary.tab, boundary.address, TITLE, boundary.arrival))
      )

      yield* Effect.promise(() => double.watched)
      double.sight({ address: ADDRESS, tabId: 1 })

      const ref = yield* board.open(1)
      const settled = yield* SubscriptionRef.changes(ref).pipe(
        Stream.filter((reading: Reading) =>
          reading.standing._tag === "Enquiring" &&
          isSettled(reading.standing.knowledge.coverage)
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("10 seconds")
      )
      yield* Fiber.interrupt(boundaries)

      const before = settled[0]
      if (before === undefined) throw new Error("the Reading never settled")
      const askedBeforeSummarising = [...recorded.asked]

      yield* board.summarise(1)
      const written = yield* SubscriptionRef.changes(ref).pipe(
        Stream.filter((reading: Reading) =>
          reading.standing._tag === "Enquiring" &&
          reading.standing.knowledge.digest._tag === "Written"
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("10 seconds")
      )
      const after = written[0]
      if (after === undefined) throw new Error("no Digest was written")

      return {
        beforeAsking: panelOf(before, NOW, AGREED),
        afterAsking: panelOf(after, NOW, AGREED),
        askedBeforeSummarising,
        asked: [...recorded.asked]
      }
    })).pipe(
      Effect.provide(Pipeline.on(WebExt.doubleLayer(double), recorded.layer))
    )
  )
}

describe("summarising, through the graph that ships", () => {
  it("fetches no comment and asks no Provider until the reader says so", async () => {
    const { askedBeforeSummarising } = await readingAndSummarising()
    // The whole page load: searches only.
    expect(askedBeforeSummarising.some((url) => url.includes("/api/v1/items/"))).toBe(false)
    expect(askedBeforeSummarising.some((url) => url.includes("/chat/completions"))).toBe(false)
    expect(askedBeforeSummarising.some((url) => url.includes("hn.algolia.com/api/v1/search"))).toBe(
      true
    )
  })

  it("says what pressing the button would cost, before it is pressed", async () => {
    const { beforeAsking } = await readingAndSummarising()
    const offer = beforeAsking.digest.offer
    expect(offer?.kind).toBe("write")
    expect(offer?.says).toContain("read the comments of")
    expect(offer?.says).toContain("send them to your own API key")
    expect(beforeAsking.digest.findings).toHaveLength(0)
  })

  it("reads the comments and writes a Digest once the reader presses it", async () => {
    const { afterAsking, asked } = await readingAndSummarising()
    expect(asked.some((url) => url.includes(`/api/v1/items/${ITEM_ID}`))).toBe(true)
    expect(asked.some((url) => url.includes("/chat/completions"))).toBe(true)

    expect(afterAsking.digest.findings).toHaveLength(1)
    expect(afterAsking.digest.findings[0]?.statement).toContain("licensing question")
    // The link the reader can follow to check it: the comment, not the thread.
    expect(afterAsking.digest.findings[0]?.sources[0]?.permalink).toBe(
      "https://news.ycombinator.com/item?id=5001"
    )
    expect(afterAsking.digest.wrote).toContain("a-model")
  })

  it("summarises only the Discussions whose own link points at this page", async () => {
    // The recorded bodies carry topical hits as well as linked ones. A Topical
    // Mention proves the subject matter was discussed, never that the
    // conversation is about this page, so summarising one would attribute a
    // stranger's argument to the page the reader is on.
    const { asked } = await readingAndSummarising()
    const items = asked.filter((url) => url.includes("/api/v1/items/"))
    expect(items.length).toBeGreaterThan(0)
    // The recorded body's sixth hit was submitted under a different article and
    // was dropped by the connector. Its comments must never be read.
    expect(items.some((url) => url.includes(WRONG_ARTICLE_ID))).toBe(false)
    expect(items.some((url) => url.includes(ITEM_ID))).toBe(true)
  })
})
