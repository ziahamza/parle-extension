/**
 * The promise ADR 0012 rests on: the key is the destination, resolution is
 * total, and the price of both is bounded.
 */
import { describe, expect, it } from "vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SubjectIdentity } from "@parle/policy/SubjectIdentity"
import { type Budget, LinkResolver } from "./LinkResolver.ts"
import { Redirects, type Trail } from "./Redirects.ts"

const generous: Budget = { requests: 50, window: Duration.minutes(1), demand: 10 }

const article = "https://www.nature.com/articles/d41586-024-02012-5"

/** A `t.co` that goes through a publisher's own tracker before landing. */
const chain = {
  "https://t.co/x7Kd2Ab": "https://nature.com/r/?u=article",
  "https://nature.com/r/?u=article": article,
  "https://t.co/Zq9Lm3P": "https://example.com/a-second-story?utm_source=twitter"
} satisfies Record<string, string>

/** A Redirects that counts what it was asked, so caching is observable. */
const counting = (answers: Readonly<Record<string, Trail>>) => {
  const asked: Array<string> = []
  const layer = Layer.succeed(Redirects)(
    Redirects.of({
      follow: (url) =>
        Effect.sync(() => {
          asked.push(url)
          return answers[url] ?? { _tag: "Lost", why: "Refusal", requests: 1 }
        })
    })
  )
  return { layer, asked }
}

const withResolver = <A>(
  redirects: Layer.Layer<Redirects>,
  budget: Budget,
  use: (resolver: LinkResolver["Service"]) => Effect.Effect<A>
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function*() {
      return yield* use(yield* LinkResolver)
    }).pipe(
      Effect.provide(
        Layer.provide(LinkResolver.layerWith(budget), Layer.mergeAll(SubjectIdentity.layer, redirects))
      )
    )
  )

describe("the key is the destination, never the shortlink", () => {
  it("follows a t.co the whole way and keys on where it landed", async () => {
    const resolution = await withResolver(
      Redirects.fixed(chain),
      generous,
      (resolver) => resolver.destinationOf("https://t.co/x7Kd2Ab")
    )

    expect(resolution._tag).toBe("Resolved")
    expect(resolution._tag === "Resolved" ? resolution.subject : "").toBe("https://nature.com/articles/d41586-024-02012-5")
    // The href the reader saw survives as evidence, which is what lets a
    // Mention be repaired later.
    expect(resolution.raw).toBe("https://t.co/x7Kd2Ab")
  })

  it("canonicalizes the destination rather than storing it as served", async () => {
    const resolution = await withResolver(
      Redirects.fixed(chain),
      generous,
      (resolver) => resolver.destinationOf("https://t.co/Zq9Lm3P")
    )
    // `utm_source` is a campaign, not a page. Two readers arriving from
    // different campaigns must land on one key.
    expect(resolution._tag === "Resolved" ? resolution.subject : "").toBe("https://example.com/a-second-story")
  })

  it("unwraps a tracking wrapper for nothing, spending no request at all", async () => {
    const redirects = counting({})
    const resolution = await withResolver(
      redirects.layer,
      generous,
      (resolver) => resolver.destinationOf(`https://out.reddit.com/?url=${encodeURIComponent(article)}&token=abc`)
    )

    expect(resolution._tag === "Resolved" ? resolution.subject : "").toBe("https://nature.com/articles/d41586-024-02012-5")
    expect(resolution._tag === "Resolved" ? resolution.requests : -1).toBe(0)
    expect(redirects.asked).toEqual([])
  })

  it("treats an ordinary link as already resolved", async () => {
    const redirects = counting({})
    const resolution = await withResolver(
      redirects.layer,
      generous,
      (resolver) => resolver.destinationOf(article)
    )
    expect(resolution._tag).toBe("Resolved")
    expect(redirects.asked).toEqual([])
  })
})

describe("a shortlink is never mistaken for its own destination", () => {
  /** The extension's ordinary situation: a cross-origin answer we may not read. */
  const filtered: typeof globalThis.fetch = () => {
    const response = new Response("", { status: 200 })
    Object.defineProperty(response, "url", { value: "" })
    return Promise.resolve(response)
  }

  it("does not mint a Resolved keyed on the t.co when the answer is opaque", async () => {
    const resolution = await withResolver(
      Redirects.fetching({ fetch: filtered }),
      generous,
      (resolver) => resolver.destinationOf("https://t.co/x7Kd2Ab")
    )

    // The failure this guards is not a crash. It is a `Resolved` whose subject
    // is the tracking URL: cached for a week, indistinguishable downstream from
    // a destination we actually learned, and rendering as an empty panel on
    // every page the reader clicks through to. An `Unresolved` on the same key
    // is not the same thing — it is marked, short-lived and repairable.
    expect(resolution._tag).not.toBe("Resolved")
    expect(resolution._tag).toBe("Unresolved")
    expect(resolution._tag === "Unresolved" ? resolution.why : "").toBe("Refusal")
  })

  it("does not let the shortlink become a Resolved when the redirector redirects nowhere", async () => {
    const wall: typeof globalThis.fetch = (input) => {
      const response = new Response("", { status: 200 })
      Object.defineProperty(response, "url", { value: String(input) })
      return Promise.resolve(response)
    }
    const resolution = await withResolver(
      Redirects.fetching({ fetch: wall }),
      generous,
      (resolver) => resolver.destinationOf("https://t.co/wall")
    )

    expect(resolution._tag === "Unresolved" ? resolution.why : "").toBe("Garble")
  })
})

describe("resolution is total: a link is never dropped", () => {
  it("keeps a refused shortlink on the shortlink, marked unresolved", async () => {
    const resolution = await withResolver(
      Redirects.fixed({}),
      generous,
      (resolver) => resolver.destinationOf("https://t.co/unreachable")
    )

    expect(resolution._tag).toBe("Unresolved")
    expect(resolution._tag === "Unresolved" ? resolution.why : "").toBe("Refusal")
    // The Mention still has somewhere to live. A Mention on a key nobody lands
    // on is a miss; a Mention nobody wrote is a Discussion this machine has
    // decided does not exist.
    expect(resolution._tag === "Unresolved" ? resolution.subject : "").toBe("https://t.co/unreachable")
  })

  it("calls a redirect loop a Garble and still keeps the Mention", async () => {
    const resolution = await withResolver(
      Redirects.fixed({ "https://t.co/loop": "https://t.co/loop" }),
      generous,
      (resolver) => resolver.destinationOf("https://t.co/loop")
    )
    expect(resolution._tag === "Unresolved" ? resolution.why : "").toBe("Garble")
  })

  it("reports a link that is not a page as nothing, which is not a loss", async () => {
    const resolution = await withResolver(
      Redirects.fixed({}),
      generous,
      (resolver) => resolver.destinationOf("mailto:someone@example.com")
    )
    // There is no page for a Mention to be about, so none is written and none
    // was lost.
    expect(resolution._tag).toBe("NotASubject")
  })

  it("does not invent a destination when the redirector answers with one", async () => {
    const resolution = await withResolver(
      Redirects.fixed({ "https://t.co/internal": "http://192.168.1.1/admin" }),
      generous,
      (resolver) => resolver.destinationOf("https://t.co/internal")
    )
    expect(resolution._tag === "Unresolved" ? resolution.why : "").toBe("Garble")
    expect(resolution._tag === "Unresolved" ? resolution.subject : "").toBe("https://t.co/internal")
  })
})

describe("the price is bounded", () => {
  it("asks once for a link however often it is seen", async () => {
    const redirects = counting({ "https://t.co/x7Kd2Ab": { _tag: "Landed", url: article, requests: 1 } })
    await withResolver(redirects.layer, generous, (resolver) =>
      Effect.gen(function*() {
        yield* resolver.destinationOf("https://t.co/x7Kd2Ab")
        yield* resolver.destinationOf("https://t.co/x7Kd2Ab")
        yield* resolver.destinationOf("https://t.co/x7Kd2Ab")
      }))

    expect(redirects.asked).toHaveLength(1)
  })

  it("dedupes within a batch, so one article posted six times costs one request", async () => {
    const redirects = counting({ "https://t.co/x7Kd2Ab": { _tag: "Landed", url: article, requests: 1 } })
    const resolutions = await withResolver(
      redirects.layer,
      generous,
      (resolver) => resolver.destinationsOf(Array.from({ length: 6 }, () => "https://t.co/x7Kd2Ab"))
    )

    expect(resolutions).toHaveLength(6)
    expect(redirects.asked).toHaveLength(1)
  })

  it("stops asking once the budget is spent, and says why", async () => {
    const tight: Budget = { requests: 1, window: Duration.minutes(1), demand: 1 }
    const answers = {
      // SAFETY: the fixture is a complete Landed trail.
      "https://t.co/one": { _tag: "Landed", url: article, requests: 1 } as Trail,
      // SAFETY: the fixture is a complete Landed trail.
      "https://t.co/two": { _tag: "Landed", url: "https://example.com/two", requests: 1 } as Trail
    }
    const redirects = counting(answers)

    const [first, second, left] = await withResolver(redirects.layer, tight, (resolver) =>
      Effect.gen(function*() {
        const one = yield* resolver.destinationOf("https://t.co/one")
        const two = yield* resolver.destinationOf("https://t.co/two")
        return [one, two, yield* resolver.remaining] as const
      }))

    expect(first?._tag).toBe("Resolved")
    expect(second?._tag).toBe("Unresolved")
    expect(second !== undefined && second._tag === "Unresolved" ? second.why : "").toBe("Withholding")
    expect(left).toBe(0)
    expect(redirects.asked).toEqual(["https://t.co/one"])
  })

  it("never remembers a Withholding, so a spent hour is not a permanent blind spot", async () => {
    const brief: Budget = { requests: 1, window: Duration.millis(40), demand: 1 }
    const redirects = counting({
      "https://t.co/one": { _tag: "Landed", url: article, requests: 1 },
      "https://t.co/two": { _tag: "Landed", url: "https://example.com/two", requests: 1 }
    })

    const [withheld, later] = await withResolver(redirects.layer, brief, (resolver) =>
      Effect.gen(function*() {
        yield* resolver.destinationOf("https://t.co/one")
        const denied = yield* resolver.destinationOf("https://t.co/two")
        yield* Effect.sleep(Duration.millis(60))
        const retried = yield* resolver.destinationOf("https://t.co/two")
        return [denied, retried] as const
      }))

    expect(withheld?._tag).toBe("Unresolved")
    expect(later?._tag).toBe("Resolved")
  })

  it("keeps the demand allowance out of the harvest budget", async () => {
    const tight: Budget = { requests: 1, window: Duration.minutes(1), demand: 2 }
    const redirects = counting({
      "https://t.co/one": { _tag: "Landed", url: article, requests: 1 },
      "https://t.co/two": { _tag: "Landed", url: "https://example.com/two", requests: 1 },
      "https://t.co/three": { _tag: "Landed", url: "https://example.com/three", requests: 1 }
    })

    const urgent = await withResolver(redirects.layer, tight, (resolver) =>
      Effect.gen(function*() {
        // Spend the whole background budget first.
        yield* resolver.destinationOf("https://t.co/one")
        yield* resolver.destinationOf("https://t.co/two")
        // The reader is standing on a page. This must still be answered.
        return yield* resolver.urgentlyOf(["https://t.co/three"])
      }))

    expect(urgent[0]?._tag).toBe("Resolved")
  })

  it("does not pay twice for a link the demand channel already resolved", async () => {
    const redirects = counting({ "https://t.co/x7Kd2Ab": { _tag: "Landed", url: article, requests: 1 } })

    const asked = await withResolver(redirects.layer, generous, (resolver) =>
      Effect.gen(function*() {
        // The reader lands on a page; the demand channel resolves it urgently.
        yield* resolver.urgentlyOf(["https://t.co/x7Kd2Ab"])
        // The throttled consumer reaches the same sighting a moment later.
        yield* resolver.destinationOf("https://t.co/x7Kd2Ab")
        return [...redirects.asked]
      }))

    // Two allowances, one link, one request. The allowance is a property of the
    // budget; the destination is a property of the link.
    expect(asked).toEqual(["https://t.co/x7Kd2Ab"])
  })

  it("keeps a Withholding on the allowance it was taken against", async () => {
    const spent: Budget = { requests: 0, window: Duration.minutes(1), demand: 1 }
    const redirects = counting({ "https://t.co/x7Kd2Ab": { _tag: "Landed", url: article, requests: 1 } })

    const [background, urgent] = await withResolver(redirects.layer, spent, (resolver) =>
      Effect.gen(function*() {
        // The harvest budget is spent, so this is a Withholding.
        const withheld = yield* resolver.destinationOf("https://t.co/x7Kd2Ab")
        // It must not be mirrored: the demand allowance is untouched, and the
        // reader is standing on this page.
        const asked = yield* resolver.urgentlyOf(["https://t.co/x7Kd2Ab"])
        return [withheld, asked[0]] as const
      }))

    expect(background?._tag === "Unresolved" ? background.why : "").toBe("Withholding")
    expect(urgent?._tag).toBe("Resolved")
  })
})

describe("a navigation the browser already performed is free evidence", () => {
  it("back-fills the cache so the same shortlink never costs a request", async () => {
    const redirects = counting({})

    const resolution = await withResolver(redirects.layer, generous, (resolver) =>
      Effect.gen(function*() {
        yield* resolver.learn("https://t.co/x7Kd2Ab", `${article}?utm_campaign=share`)
        return yield* resolver.destinationOf("https://t.co/x7Kd2Ab")
      }))

    expect(resolution._tag === "Resolved" ? resolution.subject : "").toBe("https://nature.com/articles/d41586-024-02012-5")
    expect(redirects.asked).toEqual([])
  })
})
