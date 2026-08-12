/**
 * The only place harvesting spends a request, and the only place it can lie
 * about where a link went.
 *
 * The live layer is exercised through an injected `fetch` rather than described
 * in a comment, because the two properties that matter — that a refused `HEAD`
 * is retried once with `GET`, and that a filtered response is never mistaken
 * for a destination — are both invisible from the outside otherwise.
 */
import { describe, expect, it } from "vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import { Redirects, type Trail } from "./Redirects.ts"

const article = "https://www.nature.com/articles/d41586-024-02012-5"

const followWith = (layer: Layer.Layer<Redirects>, url: string): Promise<Trail> =>
  Effect.runPromise(
    Effect.gen(function*() {
      const redirects = yield* Redirects
      return yield* redirects.follow(url)
    }).pipe(Effect.provide(layer))
  )

/**
 * A `fetch` that answers from a table and records how it was called.
 *
 * The answer's `url` is defined on the instance, shadowing `Response`'s own
 * getter, because the final address after redirects is precisely the field
 * under test and there is no other way to set it.
 */
const answering = (
  answers: Readonly<Record<string, { readonly ok: boolean; readonly url: string }>>
) => {
  const calls: Array<string> = []
  const ask: typeof globalThis.fetch = (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    calls.push(`${method} ${url}`)
    const answer = answers[`${method} ${url}`] ?? answers[url]
    if (answer === undefined) return Promise.reject(new Error("unreachable"))
    const response = new Response("", { status: answer.ok ? 200 : 404 })
    Object.defineProperty(response, "url", { value: answer.url })
    return Promise.resolve(response)
  }
  return { calls, ask }
}

describe("asking nothing is a real answer", () => {
  it("reports a Withholding rather than pretending the link is its own destination", async () => {
    const trail = await followWith(Redirects.none, "https://t.co/x7Kd2Ab")
    expect(trail).toEqual({ _tag: "Lost", why: "Withholding", requests: 0 })
  })
})

describe("following a chain", () => {
  it("walks every hop and reports what it spent", async () => {
    const trail = await followWith(
      Redirects.fixed({
        "https://t.co/x7Kd2Ab": "https://nature.com/r/?u=1",
        "https://nature.com/r/?u=1": article
      }),
      "https://t.co/x7Kd2Ab"
    )
    expect(trail).toEqual({ _tag: "Landed", url: article, requests: 2 })
  })

  it("calls a cycle a Garble rather than looping forever", async () => {
    const trail = await followWith(
      Redirects.fixed({ "https://a.test/1": "https://a.test/2", "https://a.test/2": "https://a.test/1" }),
      "https://a.test/1"
    )
    expect(trail._tag).toBe("Lost")
    expect(trail._tag === "Lost" ? trail.why : "").toBe("Garble")
  })
})

describe("the live path", () => {
  it("reads the address the platform landed on, not the one we asked about", async () => {
    const fetching = answering({ "https://t.co/x7Kd2Ab": { ok: true, url: article } })
    const trail = await followWith(Redirects.fetching({ fetch: fetching.ask }), "https://t.co/x7Kd2Ab")

    expect(trail).toEqual({ _tag: "Landed", url: article, requests: 1 })
    expect(fetching.calls).toEqual(["HEAD https://t.co/x7Kd2Ab"])
  })

  it("spends a second request on GET when the redirector refuses HEAD", async () => {
    const fetching = answering({ "GET https://t.co/x7Kd2Ab": { ok: true, url: article } })
    const trail = await followWith(Redirects.fetching({ fetch: fetching.ask }), "https://t.co/x7Kd2Ab")

    expect(trail).toEqual({ _tag: "Landed", url: article, requests: 2 })
    expect(fetching.calls).toEqual(["HEAD https://t.co/x7Kd2Ab", "GET https://t.co/x7Kd2Ab"])
  })

  it("charges a refusal for what it cost, because a cap counts requests", async () => {
    const fetching = answering({})
    const trail = await followWith(Redirects.fetching({ fetch: fetching.ask }), "https://t.co/gone")

    expect(trail).toEqual({ _tag: "Lost", why: "Refusal", requests: 2 })
  })

  it("never reports the address it asked about as the destination it found", async () => {
    // A filtered cross-origin response has an empty `url` — in an extension,
    // the ordinary shape of "you may not read this". Returning the shortlink
    // back as a `Landed` makes the LinkResolver mint a `Resolved` whose subject
    // IS the tracking URL, cached for a week and indistinguishable from a real
    // destination: the exact failure ADR 0012 exists to prevent, wearing the
    // tag of its success. We could not hear the answer, so: Refusal.
    const fetching = answering({ "https://t.co/opaque": { ok: true, url: "" } })
    const trail = await followWith(Redirects.fetching({ fetch: fetching.ask }), "https://t.co/opaque")

    expect(trail).toEqual({ _tag: "Lost", why: "Refusal", requests: 1 })
  })

  it("calls a shortener that redirects nowhere a Garble, not a destination", async () => {
    // A 200 at the address we asked about, from a host we only ask about
    // because it is a shortener, is an interstitial served as success — the
    // glossary's Garble, verbatim — and emphatically not a page.
    const fetching = answering({ "https://t.co/wall": { ok: true, url: "https://t.co/wall" } })
    const trail = await followWith(Redirects.fetching({ fetch: fetching.ask }), "https://t.co/wall")

    expect(trail).toEqual({ _tag: "Lost", why: "Garble", requests: 1 })
  })

  it("spends nothing where there is no fetch to spend it on", async () => {
    // A context without `fetch` threw on every call — after `tryPromise`
    // caught it, twice per link, each one charged to ADR 0012's hourly cap for
    // traffic that never happened. The whole budget, spent on nothing.
    const real = globalThis.fetch
    Reflect.deleteProperty(globalThis, "fetch")
    try {
      const trail = await followWith(Redirects.fetching(), "https://t.co/nowhere")
      expect(trail).toEqual({ _tag: "Lost", why: "Withholding", requests: 0 })
    } finally {
      globalThis.fetch = real
    }
  })

  it("stays total when the platform hands back something that is not a Response", async () => {
    // `follow` is declared total. A patched or polyfilled `fetch` that answers
    // with the wrong shape used to throw while reading `.ok` — outside
    // `tryPromise`'s guard — and the defect travelled into the Harvester's
    // forked daemon, which is the one fiber in this package that must never die.
    // SAFETY: the test double matches fetch's call signature; we only record the URL.
    const wrong: typeof globalThis.fetch = (() => Promise.resolve(undefined)) as never
    const trail = await followWith(Redirects.fetching({ fetch: wrong }), "https://t.co/strange")

    expect(trail._tag).toBe("Lost")
  })

  it("gives up rather than holding a slot in the queue forever", async () => {
    const hanging: typeof globalThis.fetch = () => new Promise(() => {})
    const trail = await followWith(
      Redirects.fetching({ fetch: hanging, timeout: Duration.millis(20) }),
      "https://t.co/slow"
    )

    expect(trail._tag).toBe("Lost")
    expect(trail._tag === "Lost" ? trail.why : "").toBe("Refusal")
  })
})
