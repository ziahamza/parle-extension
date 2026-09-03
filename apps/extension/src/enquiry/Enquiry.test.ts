/**
 * Enquiry.readDiscussion is an idempotent open, not a toggle.
 *
 * Auto-open is the only production caller. Close/reopen resets view state and
 * asks again; if a completed Read were toggled off, commentsNode would stay
 * on Loading comments forever. A bare return is not enough either: without a
 * SubscriptionRef write there is no new frame, so a stale panel never catches
 * up. This file drives the real Enquiry through Pipeline — render.test.ts
 * never runs Enquiry, and closeSurface.test.ts only greps resetViewState().
 * Sequential asks miss the overlap: two in-flight readDiscussions cannot
 * replace a completed Read with a stale Reading.
 */
import { describe, expect, it } from "vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { isSettled } from "@parle/domain/Coverage"
import { discussionKey } from "@parle/domain/Network"
import { hackerNewsLinked, hackerNewsTopical } from "@parle/networks/Recorded"
import { type Exchange, recording } from "@parle/networks/Recording"
import { makeDouble, WebExt } from "@parle/browser/WebExtApi"
import { ReadingWatch } from "@parle/browser/ReadingWatch"
import { Board } from "../reading/Board.ts"
import type { Reading } from "../reading/Reading.ts"
import { Settings, withAutomatic } from "../settings/Settings.ts"
import * as Pipeline from "../app/Pipeline.ts"

const ADDRESS = "https://www.nature.com/articles/d41586-024-02012-5"
const TITLE = "Not all 'open source' AI models are open"
const ITEM_ID = "40786237"

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
      text: "<p>The licence is the whole story.</p>"
    }
  ]
})

const json = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json" }
})

const wire = (url: string): Exchange => {
  if (url.includes("hn.algolia.com/api/v1/items")) return json(thread)
  if (url.includes("hn.algolia.com")) {
    return json(url.includes("restrictSearchableAttributes") ? hackerNewsLinked : hackerNewsTopical)
  }
  return { status: 403, body: "<html>blocked</html>", headers: { "content-type": "text/html" } }
}

/** Hold the comments fetch until both asks are in flight. */
const gatedComments = (
  answer: (url: string) => Exchange,
  gate: Effect.Effect<void>
) => {
  const asked: Array<string> = []
  const client = HttpClient.make((request, url) => {
    const address = url.toString()
    asked.push(address)
    const exchange = answer(address)
    const respond = Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(exchange.body, {
          status: exchange.status,
          headers: exchange.headers ?? { "content-type": "application/json" }
        })
      )
    )
    if (address.includes("/api/v1/items")) return Effect.andThen(gate, respond)
    return respond
  })
  return { layer: Layer.succeed(HttpClient.HttpClient, client), asked }
}

const knowledgeOf = (reading: Reading) => {
  if (reading.standing._tag !== "Enquiring") {
    throw new Error(`expected Enquiring, got ${reading.standing._tag}`)
  }
  return reading.standing.knowledge
}

describe("Enquiry.readDiscussion", () => {
  it("keeps a completed Read when asked a second time, and writes a new frame", async () => {
    const double = makeDouble()
    const recorded = recording(wire)

    const tags = await Effect.runPromise(
      Effect.scoped(Effect.gen(function*() {
        const watch = yield* ReadingWatch
        const board = yield* Board
        const settings = yield* Settings
        yield* settings.change((held) => withAutomatic(held, true))

        const boundaries = yield* Effect.forkScoped(
          Stream.runForEach(watch.readings, (boundary) =>
            board.sight(boundary.tab, boundary.address, TITLE, boundary.arrival))
        )

        yield* Effect.promise(() => double.watched)
        double.sight({ address: ADDRESS, tabId: 1 })

        const ref = yield* board.open(1)
        yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter((reading: Reading) =>
            reading.standing._tag === "Enquiring" &&
            isSettled(reading.standing.knowledge.coverage)
          ),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("10 seconds")
        )
        yield* Fiber.interrupt(boundaries)

        const settled = knowledgeOf(yield* SubscriptionRef.get(ref))
        const discussion = settled.discussions.find((one) => one.id.nativeId === ITEM_ID) ??
          settled.discussions[0]
        if (discussion === undefined) throw new Error("expected a Discussion")
        const key = discussionKey(discussion.id)

        yield* board.readDiscussion(1, key)
        yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter((reading: Reading) => {
            const held = new Map(knowledgeOf(reading).opened).get(key)
            return held?._tag === "Read"
          }),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("10 seconds")
        )

        const firstKnowledge = knowledgeOf(yield* SubscriptionRef.get(ref))
        const first = new Map(firstKnowledge.opened).get(key)
        const openedBefore = firstKnowledge.opened
        yield* board.readDiscussion(1, key)
        yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter((reading: Reading) =>
            knowledgeOf(reading).opened !== openedBefore
          ),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("3 seconds")
        )
        const secondKnowledge = knowledgeOf(yield* SubscriptionRef.get(ref))
        const second = new Map(secondKnowledge.opened).get(key)
        return {
          first: first?._tag,
          second: second?._tag,
          comments: second?._tag === "Read" ? second.comments.length : 0
        }
      })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), recorded.layer)))
    )

    expect(tags.first).toBe("Read")
    expect(tags.second).toBe("Read")
    expect(tags.comments).toBeGreaterThan(0)
  }, 25_000)

  it("does not replace a completed Read with a stale Reading from an overlapping ask", async () => {
    const double = makeDouble()
    const gate = Effect.runSync(Deferred.make<void>())
    const recorded = gatedComments(wire, Deferred.await(gate))

    const result = await Effect.runPromise(
      Effect.scoped(Effect.gen(function*() {
        const watch = yield* ReadingWatch
        const board = yield* Board
        const settings = yield* Settings
        yield* settings.change((held) => withAutomatic(held, true))

        const boundaries = yield* Effect.forkScoped(
          Stream.runForEach(watch.readings, (boundary) =>
            board.sight(boundary.tab, boundary.address, TITLE, boundary.arrival))
        )

        yield* Effect.promise(() => double.watched)
        double.sight({ address: ADDRESS, tabId: 1 })

        const ref = yield* board.open(1)
        yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter((reading: Reading) =>
            reading.standing._tag === "Enquiring" &&
            isSettled(reading.standing.knowledge.coverage)
          ),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("10 seconds")
        )
        yield* Fiber.interrupt(boundaries)

        const settled = knowledgeOf(yield* SubscriptionRef.get(ref))
        const discussion = settled.discussions.find((one) => one.id.nativeId === ITEM_ID) ??
          settled.discussions[0]
        if (discussion === undefined) throw new Error("expected a Discussion")
        const key = discussionKey(discussion.id)

        const seen: Array<string> = []
        yield* Effect.forkScoped(
          Stream.runForEach(SubscriptionRef.changes(ref), (reading: Reading) =>
            Effect.sync(() => {
              const held = new Map(knowledgeOf(reading).opened).get(key)
              if (held !== undefined) seen.push(held._tag)
            })
          )
        )

        const readingHeld = (reading: Reading) =>
          new Map(knowledgeOf(reading).opened).get(key)?._tag === "Reading"
        yield* board.readDiscussion(1, key)
        if (!readingHeld(yield* SubscriptionRef.get(ref))) {
          yield* SubscriptionRef.changes(ref).pipe(
            Stream.filter(readingHeld),
            Stream.take(1),
            Stream.runCollect,
            Effect.timeout("10 seconds")
          )
        }
        yield* board.readDiscussion(1, key)
        yield* Deferred.succeed(gate, undefined)

        yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter((reading: Reading) => {
            const held = new Map(knowledgeOf(reading).opened).get(key)
            return held?._tag === "Read"
          }),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("10 seconds")
        )
        yield* Effect.sleep("50 millis")
        const final = new Map(knowledgeOf(yield* SubscriptionRef.get(ref)).opened).get(key)
        return {
          tag: final?._tag,
          comments: final?._tag === "Read" ? final.comments.length : 0,
          seen
        }
      })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), recorded.layer)))
    )

    expect(result.tag).toBe("Read")
    expect(result.comments).toBeGreaterThan(0)
    const readAt = result.seen.indexOf("Read")
    expect(readAt).toBeGreaterThan(-1)
    expect(result.seen.slice(readAt).every((tag) => tag === "Read")).toBe(true)
  }, 25_000)

})
