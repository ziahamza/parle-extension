/**
 * The negative memory: what may be remembered, and what it may never do.
 *
 * The interesting assertions here are the ones about what this store CANNOT
 * cause. ADR 0005 forbids gating a Lookup on a partial index because the
 * failure is a silent false negative; this store is permitted only because its
 * failure is the mirror — a fold that the next answer undoes. Two of the tests
 * below are that argument written as code: a judgement that disagrees with the
 * evidence is dropped, and a judgement made by other rules is not consulted.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"
import type { SubjectUrl } from "@parle/domain/Subject"
import { FrontDoorMemory, PREFIX, siteOf, TRUSTED_FOR_MS } from "./FrontDoorMemory.ts"
import { OpaqueKeys } from "./OpaqueKeys.ts"
import { Storage } from "./Storage.ts"

const RULES = 1
const url = (raw: string): SubjectUrl => raw as SubjectUrl

/** One install's salt, so a key is reproducible across two `run` calls. */
const SALT = "a-test-install"

const wired = (backing: Map<string, string>, rules: number) =>
  FrontDoorMemory.layer(rules).pipe(
    Layer.provide(Storage.memory(backing)),
    Layer.provide(OpaqueKeys.layerWithSalt(SALT))
  )

const run = <A>(
  self: Effect.Effect<A, never, FrontDoorMemory>,
  backing: Map<string, string> = new Map(),
  rules = RULES
): Promise<A> => Effect.runPromise(self.pipe(Effect.provide(wired(backing, rules))))

/** The key a given address lands under, computed the way the store computes it. */
const keyOf = (subject: SubjectUrl): Promise<string> =>
  Effect.runPromise(
    Effect.gen(function*() {
      const keys = yield* OpaqueKeys
      return `${PREFIX}${(yield* keys.conceal(`frontdoor ${siteOf(subject)}`)) as string}`
    }).pipe(Effect.provide(OpaqueKeys.layerWithSalt(SALT)))
  )

describe("what is remembered, and where", () => {
  it("remembers a site rather than an address", () => {
    // Every entry is a root address, because the rule only ever fires on one.
    // That is what makes the shipped form a host list rather than a URL list.
    expect(siteOf(url("https://facebook.com/"))).toBe("facebook.com")
    expect(siteOf(url("https://FACEBOOK.com/"))).toBe("facebook.com")
  })

  it("keeps a locale root apart from the site it is on", () => {
    // `example.com/en` is a front door with a path. Folding it onto the host
    // alone would judge a whole site from one of its language homepages.
    expect(siteOf(url("https://example.com/en"))).toBe("example.com/en")
  })

  it("puts no address on the reader's disk", async () => {
    // This store IS a record of what the reader read — a verdict is only ever
    // written after an Enquiry on that address — so it is keyed the way the
    // Lookup Record is, and for the same reason.
    const backing = new Map<string, string>()
    await run(
      Effect.gen(function*() {
        const memory = yield* FrontDoorMemory
        yield* memory.remember(url("https://bankofamerica.com/"), { because: "incident", judgedThrough: 0 })
      }),
      backing
    )
    expect([...backing.keys()].join(" ")).not.toContain("bankofamerica")
    expect([...backing.values()].join(" ")).not.toContain("bankofamerica")
  })

  it("comes back", async () => {
    const held = await run(
      Effect.gen(function*() {
        const memory = yield* FrontDoorMemory
        yield* memory.remember(url("https://facebook.com/"), {
          because: "incident",
          judgedThrough: 1_700_000_000_000
        })
        return yield* memory.recall(url("https://facebook.com/"))
      })
    )
    expect(Option.isSome(held)).toBe(true)
    expect(Option.getOrThrow(held).because).toBe("incident")
    expect(Option.getOrThrow(held).judgedThrough).toBe(1_700_000_000_000)
  })

  it("has nothing to say about an address nobody judged", async () => {
    const held = await run(
      Effect.gen(function*() {
        const memory = yield* FrontDoorMemory
        return yield* memory.recall(url("https://paulgraham.com/greatwork.html"))
      })
    )
    expect(Option.isNone(held)).toBe(true)
  })
})

describe("a judgement that should not be believed", () => {
  it("is dropped when the rules that made it are gone", async () => {
    // Re-derivation costs nothing — titles and timestamps are already in the
    // answer — so a judgement from other rules is discarded rather than aged.
    const backing = new Map<string, string>()
    await run(
      Effect.gen(function*() {
        const memory = yield* FrontDoorMemory
        yield* memory.remember(url("https://facebook.com/"), { because: "incident", judgedThrough: 0 })
      }),
      backing,
      1
    )
    const held = await run(
      Effect.gen(function*() {
        const memory = yield* FrontDoorMemory
        return yield* memory.recall(url("https://facebook.com/"))
      }),
      backing,
      2
    )
    expect(Option.isNone(held)).toBe(true)
  })

  it("expires on the wall clock as a backstop", async () => {
    const backing = new Map<string, string>()
    backing.set(
      await keyOf(url("https://facebook.com/")),
      JSON.stringify({
        because: "incident",
        rulesVersion: RULES,
        judgedThrough: 0,
        judgedAt: Date.now() - TRUSTED_FOR_MS - 1
      })
    )
    const held = await run(
      Effect.gen(function*() {
        const memory = yield* FrontDoorMemory
        return yield* memory.recall(url("https://facebook.com/"))
      }),
      backing
    )
    expect(Option.isNone(held)).toBe(true)
  })

  it("is taken back off the moment the rule disagrees", async () => {
    // The self-correcting half. A page that grows a real conversation stops
    // being remembered on the next answer, not on the next release.
    const held = await run(
      Effect.gen(function*() {
        const memory = yield* FrontDoorMemory
        yield* memory.remember(url("https://ghostty.org/"), { because: "titles-disagree", judgedThrough: 1 })
        yield* memory.forget(url("https://ghostty.org/"))
        return yield* memory.recall(url("https://ghostty.org/"))
      })
    )
    expect(Option.isNone(held)).toBe(true)
  })

  it("is unreadable rubbish, and reads as nothing rather than as a verdict", async () => {
    const backing = new Map<string, string>([[await keyOf(url("https://facebook.com/")), "{not json"]])
    const held = await run(
      Effect.gen(function*() {
        const memory = yield* FrontDoorMemory
        return yield* memory.recall(url("https://facebook.com/"))
      }),
      backing
    )
    expect(Option.isNone(held)).toBe(true)
  })
})

describe("a store that will not take it", () => {
  const broken = <A>(self: Effect.Effect<A, never, FrontDoorMemory>): Promise<A> =>
    Effect.runPromise(
      self.pipe(
        Effect.provide(
          FrontDoorMemory.layer(RULES).pipe(
            Layer.provide(Storage.unavailable()),
            Layer.provide(OpaqueKeys.layerWithSalt(SALT))
          )
        )
      )
    )

  it("does not fail the write", async () => {
    // MV3 kills the worker without finalizers, and a reader whose disk is full
    // still gets a panel. The cost of a lost write is one unfolded first frame.
    await expect(
      broken(
        Effect.gen(function*() {
          const memory = yield* FrontDoorMemory
          yield* memory.remember(url("https://facebook.com/"), { because: "incident", judgedThrough: 0 })
        })
      )
    ).resolves.toBeUndefined()
  })

  it("reads as nothing known, which is the direction that shows Discussions", async () => {
    const held = await broken(
      Effect.gen(function*() {
        const memory = yield* FrontDoorMemory
        return yield* memory.recall(url("https://facebook.com/"))
      })
    )
    expect(Option.isNone(held)).toBe(true)
  })
})

describe("clearing", () => {
  it("takes every judgement and nothing else", async () => {
    const backing = new Map<string, string>([["parle/recall/keep-me", "{}"]])
    await run(
      Effect.gen(function*() {
        const memory = yield* FrontDoorMemory
        yield* memory.remember(url("https://facebook.com/"), { because: "incident", judgedThrough: 0 })
        yield* memory.remember(url("https://google.com/"), { because: "titles-disagree", judgedThrough: 0 })
        yield* memory.forgetAll
      }),
      backing
    )
    expect([...backing.keys()]).toEqual(["parle/recall/keep-me"])
  })
})
