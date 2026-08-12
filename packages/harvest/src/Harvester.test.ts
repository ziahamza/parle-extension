/**
 * The pipeline's two promises: the Mention is keyed on where the link went, and
 * nothing offered to it is ever silently lost.
 *
 * The second is tested with a hand-off deliberately smaller than the work
 * pushed through it. `sliding` and `dropping` pass every other test in this
 * file and fail this one by delivering 2 of 8 — with no event, no failure and
 * no log line, which is why it is asserted rather than assumed.
 */
import { describe, expect, it } from "vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import type { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { SubjectUrl } from "@parle/domain/Subject"
import { Recollection } from "@parle/memory/Recollection"
import { Storage } from "@parle/memory/Storage"
import { SubjectIdentity } from "@parle/policy/SubjectIdentity"
import { xTimeline } from "./Fixtures.ts"
import { defaultPace, Harvester, type Pace } from "./Harvester.ts"
import { type Budget, LinkResolver } from "./LinkResolver.ts"
import { BreakageSink, NetworkPage } from "./Page.ts"
import { Redirects } from "./Redirects.ts"

const budget: Budget = { requests: 100, window: Duration.minutes(1), demand: 50 }

const article = "https://www.nature.com/articles/d41586-024-02012-5"
const second = "https://example.com/a-second-story"

/** What X's `t.co` links actually lead to. */
const chain = {
  "https://t.co/x7Kd2Ab": article,
  "https://t.co/Zq9Lm3P": second
} satisfies Record<string, string>

const withHarvester = <A>(
  pace: Pace,
  use: (harvester: Harvester["Service"], recollection: Recollection["Service"]) => Effect.Effect<A>
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function*() {
      return yield* use(yield* Harvester, yield* Recollection)
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          Harvester.layerWith(pace),
          Layer.mergeAll(
            Layer.provide(
              LinkResolver.layerWith(budget),
              Layer.mergeAll(SubjectIdentity.layer, Redirects.fixed(chain))
            ),
            Layer.provide(Recollection.layer, Storage.memory())
          )
        )
      )
    )
  )

/** Poll until the pipeline has caught up, or give up and let the assertion fail. */
const settled = (harvester: Harvester["Service"]) =>
  Effect.gen(function*() {
    for (let attempt = 0; attempt < 400; attempt++) {
      if ((yield* harvester.waiting) === 0) return
      yield* Effect.sleep(Duration.millis(5))
    }
  })

const recall = (recollection: Recollection["Service"], subject: string) =>
  Stream.runCollect(recollection.recall(SubjectUrl.make(subject)))

const timeline = NetworkPage.make({ network: "x", url: "https://x.com/home", markup: xTimeline })

/** A Hacker News list page with `count` stories, each linking somewhere distinct. */
const listingWith = (count: number): string => {
  const rows = Array.from({ length: count }, (_, index) => {
    const id = 41000000 + index
    return `<tr class='athing submission' id='${id}'>
      <td class="title"><span class="titleline"><a href="https://example.com/story-${index}">Story ${index}</a></span></td>
    </tr>
    <tr><td class="subtext"><span class="subline">
      <span class="score" id="score_${id}">${index} points</span>
      <a href="item?id=${id}">${index}&nbsp;comments</a>
    </span></td></tr>`
  }).join("\n")
  return `<html><body><table class="itemlist">${rows}</table></body></html>`
}

describe("the Mention is keyed on the destination, not on the link that was clicked", () => {
  it("resolves a t.co at harvest time and stores the Mention on where it went", async () => {
    const [onDestination, onShortlink] = await withHarvester(defaultPace, (harvester, recollection) =>
      Effect.gen(function*() {
        yield* harvester.offer(timeline)
        yield* settled(harvester)
        return [
          yield* recall(recollection, "https://nature.com/articles/d41586-024-02012-5"),
          yield* recall(recollection, "https://t.co/x7Kd2Ab")
        ] as const
      }))

    // This is ADR 0012's marquee case. Keyed on the `t.co`, the reader clicks
    // the link, lands on nature.com, and the panel is empty.
    expect(onDestination).toHaveLength(1)
    expect(onDestination[0]?._tag).toBe("Linked")
    expect(onShortlink).toHaveLength(0)
  })

  it("keeps the t.co as the evidence for the claim", async () => {
    const mentions = await withHarvester(defaultPace, (harvester, recollection) =>
      Effect.gen(function*() {
        yield* harvester.offer(timeline)
        yield* settled(harvester)
        return yield* recall(recollection, "https://nature.com/articles/d41586-024-02012-5")
      }))

    const only: Mention | undefined = mentions[0]
    expect(only?._tag === "Linked" ? only.viaAlias : "").toBe("https://t.co/x7Kd2Ab")
  })

  it("records the Discussion's numbers without waiting for any resolution", async () => {
    // The first post on the fixture timeline.
    const post = DiscussionId.make({ network: "x", nativeId: NativeId.make("1805123456789012345") })

    const held = await withHarvester(defaultPace, (harvester, recollection) =>
      Effect.gen(function*() {
        yield* harvester.offer(timeline)
        // Deliberately NOT settled. A title and a score depend on no request at
        // all, so making them wait behind one would leave the panel emptier
        // than the page the reader is looking at.
        return yield* recollection.latest(post)
      }))

    expect(held._tag).toBe("Some")
    expect(held._tag === "Some" ? held.value.score : null).toBe(1200)
  })
})

describe("nothing offered is ever dropped", () => {
  const cramped: Pace = {
    capacity: 2,
    buffer: 1,
    perWindow: 64,
    window: Duration.millis(50),
    burst: 2,
    concurrency: 4
  }

  it("delivers all eight through a hand-off that holds two", async () => {
    const page = NetworkPage.make({
      network: "hackernews",
      url: "https://news.ycombinator.com/",
      markup: listingWith(8)
    })

    const found = await withHarvester(cramped, (harvester, recollection) =>
      Effect.gen(function*() {
        yield* harvester.offer(page)
        yield* settled(harvester)
        const each = yield* Effect.forEach(
          Array.from({ length: 8 }, (_, index) => `https://example.com/story-${index}`),
          (subject) => recall(recollection, subject)
        )
        return each.filter((mentions) => mentions.length === 1).length
      }))

    // Eight. Not two.
    expect(found).toBe(8)
  })

  it("makes the publisher wait rather than making room", async () => {
    const page = NetworkPage.make({
      network: "hackernews",
      url: "https://news.ycombinator.com/",
      markup: listingWith(12)
    })

    const found = await withHarvester(cramped, (harvester, recollection) =>
      Effect.gen(function*() {
        // `offer` returns only once every sighting has been accepted by the
        // pipeline — back-pressured into it, not discarded to fit. Asserting on
        // `waiting` instead would prove nothing: `offer` fills that map before
        // it publishes, so it reads the same whether the hand-off kept the work
        // or threw it away.
        yield* harvester.offer(page)
        yield* settled(harvester)
        const each = yield* Effect.forEach(
          Array.from({ length: 12 }, (_, index) => `https://example.com/story-${index}`),
          (subject) => recall(recollection, subject)
        )
        return each.filter((mentions) => mentions.length === 1).length
      }))

    expect(found).toBe(12)
  })

  it("keeps filling the cache after one sighting fails to settle", async () => {
    // The daemon is one forked fiber. If a single settle can end it, every
    // later page is lost with no error, no failed request and no log line —
    // and once the hand-off fills, `offer` blocks its caller forever. That is
    // the invisible false negative arriving through the machinery built to
    // prevent it.
    let exploded = false
    const brittle = Layer.effect(Recollection)(
      Effect.gen(function*() {
        const real = yield* Recollection
        return Recollection.of({
          ...real,
          remember: (mentions) => {
            if (exploded) return real.remember(mentions)
            exploded = true
            return Effect.die(new Error("storage went away"))
          }
        })
      })
    ).pipe(Layer.provide(Layer.provide(Recollection.layer, Storage.memory())))

    const page = NetworkPage.make({
      network: "hackernews",
      url: "https://news.ycombinator.com/",
      markup: listingWith(4)
    })

    const found = await Effect.runPromise(
      Effect.gen(function*() {
        const harvester = yield* Harvester
        const recollection = yield* Recollection
        yield* harvester.offer(page)
        yield* settled(harvester)
        const each = yield* Effect.forEach(
          Array.from({ length: 4 }, (_, index) => `https://example.com/story-${index}`),
          (subject) => recall(recollection, subject)
        )
        return { written: each.filter((mentions) => mentions.length === 1).length, waiting: yield* harvester.waiting }
      }).pipe(
        Effect.provide(
          Layer.provideMerge(
            Harvester.layerWith(defaultPace),
            Layer.mergeAll(
              Layer.provide(
                LinkResolver.layerWith(budget),
                Layer.mergeAll(SubjectIdentity.layer, Redirects.fixed(chain))
              ),
              brittle
            )
          )
        ),
        Effect.timeoutOrElse({
          duration: Duration.seconds(5),
          orElse: () => Effect.succeed({ written: -1, waiting: -1 })
        })
      )
    )

    // One lost loudly, three still recorded — and the pipeline caught up, so
    // nothing is left wedged in `pending` either.
    expect(found.written).toBe(3)
    expect(found.waiting).toBe(0)
  })
})

describe("the demand channel beats the queue to the page the reader is on", () => {
  /** One item per minute: the throttle will not deliver the rest in this test's lifetime. */
  const glacial: Pace = {
    capacity: 64,
    buffer: 8,
    perWindow: 1,
    window: Duration.minutes(1),
    burst: 0,
    concurrency: 4
  }

  it("resolves what is waiting now when a Reading says it may be the destination", async () => {
    const found = await withHarvester(glacial, (harvester, recollection) =>
      Effect.gen(function*() {
        yield* harvester.offer(timeline)
        yield* harvester.prioritise(SubjectUrl.make("https://nature.com/articles/d41586-024-02012-5"))
        return yield* recall(recollection, "https://nature.com/articles/d41586-024-02012-5")
      }))

    // Without the demand channel this is the reader watching a politely
    // throttled FIFO queue not reach the page under their thumb.
    expect(found).toHaveLength(1)
    expect(found[0]?._tag).toBe("Linked")
  })

  it("stops once the reader's own page is found, leaving the rest to the queue", async () => {
    const other = await withHarvester(glacial, (harvester, recollection) =>
      Effect.gen(function*() {
        yield* harvester.offer(timeline)
        yield* harvester.prioritise(SubjectUrl.make("https://nature.com/articles/d41586-024-02012-5"))
        return yield* recall(recollection, second)
      }))

    // The second link may or may not have been resolved by the throttled
    // consumer's one free token; what matters is that demand did not drain the
    // whole queue at the reader's expense.
    expect(other.length).toBeLessThanOrEqual(1)
  })

  it("does not leave the work it finished sitting in the queue", async () => {
    // `prioritise` settles what it resolves. Leaving the tickets in `pending`
    // meant the pipeline never read as caught up, every later `prioritise`
    // re-resolved work already done, and the throttled consumer settled the
    // very same sightings a second time behind it.
    const [before, after] = await withHarvester(glacial, (harvester) =>
      Effect.gen(function*() {
        yield* harvester.offer(timeline)
        const queued = yield* harvester.waiting
        // Nothing on this timeline resolves to this address, so `prioritise`
        // works through everything waiting rather than stopping early.
        yield* harvester.prioritise(SubjectUrl.make("https://example.com/nothing-here"))
        return [queued, yield* harvester.waiting] as const
      }))

    expect(before).toBeGreaterThan(0)
    expect(after).toBe(0)
  })
})

describe("a Network that reskins is reported rather than absorbed", () => {
  it("harvests nothing and tells the breakage sink which structure it wanted", async () => {
    const seen: Array<string> = []
    const page = NetworkPage.make({
      network: "hackernews",
      url: "https://news.ycombinator.com/",
      markup: "<html><body><div class=\"feed-v2\"></div></body></html>"
    })

    await Effect.runPromise(
      Effect.gen(function*() {
        const harvester = yield* Harvester
        yield* harvester.offer(page)
      }).pipe(
        Effect.provide(
          Layer.provide(
            Harvester.layerWith(defaultPace),
            Layer.mergeAll(
              Layer.provide(
                LinkResolver.layerWith(budget),
                Layer.mergeAll(SubjectIdentity.layer, Redirects.fixed(chain))
              ),
              Layer.provide(Recollection.layer, Storage.memory())
            )
          )
        ),
        Effect.provideService(BreakageSink, {
          broke: (breakage) => Effect.sync(() => void seen.push(breakage.expected))
        })
      )
    )

    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain("athing")
  })
})
