/**
 * The Lookup Record's lease, driven through the graph as it actually ships.
 *
 * The failure these tests pin down was found by the torture run
 * (`e2e/torture.e2e.ts`, scenario "worker death mid-Enquiry") and is the one
 * `LookupRecord`'s file header was written about: MV3 kills the service worker
 * without running finalizers, so every guard that lives in a fiber dies with
 * it, and each fresh worker lifetime re-asked every Network about a Subject the
 * previous lifetime was already asking about. Ten kills in a row were ten fresh
 * request budgets. The record's intend-before-request is the design that closes
 * that, and until this wiring existed it had never once been executed.
 *
 * What is deliberately NOT here — and must not creep in — is a skip keyed on a
 * SETTLED answer. `Enquiry.consult` gates on the two-minute lease alone: a
 * worker that skipped because a dead lifetime got an answer it cannot re-render
 * would draw "nobody discussed this page" over a page somebody did, which is
 * ADR 0005's durable false negative. `never withholds on a settled answer`
 * below is the test that holds that line.
 *
 * A "worker lifetime" here is a runtime built over a shared platform double:
 * same disk, fresh heap — exactly what MV3 leaves behind.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Duration from "effect/Duration"
import { type Consultation, isSettled } from "@parle/domain/Coverage"
import { Arrival } from "@parle/domain/Subject"
import type { Network } from "@parle/domain/Network"
import { asText, Storage as Bytes } from "@parle/browser/Storage"
import { makeDouble, WebExt, type WebExtApi } from "@parle/browser/WebExtApi"
import { defaultRetention, LookupRecord, type Retention } from "@parle/memory/LookupRecord"
import { OpaqueKeys } from "@parle/memory/OpaqueKeys"
import { Storage as Kept, StorageUnavailable } from "@parle/memory/Storage"
import { hackerNewsLinked, hackerNewsTopical } from "@parle/networks/Recorded"
import { type Exchange, recording } from "@parle/networks/Recording"
import { SubjectIdentity } from "@parle/policy/SubjectIdentity"
import { Board } from "../reading/Board.ts"
import type { Reading } from "../reading/Reading.ts"
import { Settings, withAutomatic } from "../settings/Settings.ts"
import * as Pipeline from "./Pipeline.ts"

const ADDRESS = "https://www.nature.com/articles/d41586-024-02012-5"
const TITLE = "Not all 'open source' AI models are open"

const algolia = (url: string): Exchange =>
  url.includes("hn.algolia.com")
    ? {
      status: 200,
      body: url.includes("restrictSearchableAttributes") ? hackerNewsLinked : hackerNewsTopical,
      headers: { "content-type": "application/json" }
    }
    : { status: 403, body: "<html>blocked</html>", headers: { "content-type": "text/html" } }

/**
 * The Lookup Record over the same bytes the pipeline's own sits on.
 *
 * The same mapping `Pipeline.on`'s `durableKept` makes, restated here because
 * the pipeline does not (and must not) export its internal stores. The salt at
 * `parle/memory/salt` lives in the shared double, so keys concealed here are
 * the keys the pipeline's own record reads — which is what makes an `intend`
 * from this stack a faithful stand-in for a dead worker's.
 */
const recordOver = (
  double: WebExtApi,
  retention: Retention = defaultRetention
): Layer.Layer<LookupRecord | SubjectIdentity> => {
  const bytes = Bytes.layer.pipe(Layer.provide(WebExt.doubleLayer(double)))
  const kept = Layer.effect(
    Kept,
    Effect.map(Bytes, (store) =>
      Kept.of({
        get: (key) =>
          store.get(key).pipe(
            Effect.map(Option.map(asText)),
            Effect.catch((cause) =>
              Effect.fail(new StorageUnavailable({ operation: "get", key, detail: String(cause) }))
            )
          ),
        set: (key, value) =>
          store.set(key, value).pipe(
            Effect.catch((cause) =>
              Effect.fail(new StorageUnavailable({ operation: "set", key, detail: String(cause) }))
            )
          ),
        remove: (key) =>
          store.remove(key).pipe(
            Effect.catch((cause) =>
              Effect.fail(new StorageUnavailable({ operation: "remove", key, detail: String(cause) }))
            )
          ),
        keys: (prefix) =>
          store.keys.pipe(
            Effect.map((all) => all.filter((key) => key.startsWith(prefix))),
            Effect.catch((cause) =>
              Effect.fail(new StorageUnavailable({ operation: "keys", key: prefix, detail: String(cause) }))
            )
          )
      }))
  ).pipe(Layer.provide(bytes))
  const opaque = OpaqueKeys.layer.pipe(Layer.provide(kept))
  return Layer.mergeAll(
    LookupRecord.layerWith(retention).pipe(Layer.provide(kept), Layer.provide(opaque)),
    SubjectIdentity.layer
  )
}

/** What a worker killed mid-flight leaves on disk: intents, and no outcomes. */
const dieHolding = (
  double: WebExtApi,
  asks: ReadonlyArray<readonly [Network]>,
  retention: Retention = defaultRetention
): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function*() {
      const identity = yield* SubjectIdentity
      const record = yield* LookupRecord
      const elected = yield* identity.identify(ADDRESS)
      if (Option.isNone(elected)) throw new Error("the fixture address stopped electing a Subject")
      for (const [network] of asks) {
        yield* record.intend(elected.value, network)
      }
    }).pipe(Effect.provide(recordOver(double, retention)))
  )

const EVERY_ASK: ReadonlyArray<readonly [Network]> = [
  ["hackernews"],
  ["hackernews"],
  ["reddit"],
  ["reddit"]
]

const settled = (reading: Reading): boolean =>
  reading.standing._tag === "Excluded" ||
  (reading.standing._tag === "Enquiring" && isSettled(reading.standing.knowledge.coverage))

const consultationsOf = (reading: Reading): ReadonlyArray<Consultation> =>
  reading.standing._tag === "Enquiring"
    ? reading.standing.knowledge.coverage.consultations
    : []

/**
 * One worker lifetime: sight the address, wait for Coverage to settle, and
 * optionally go on driving the same runtime.
 */
const lifetime = async <A>(
  double: WebExtApi,
  answer: (url: string) => Exchange,
  use: (
    context: {
      readonly board: Board["Service"]
      readonly reading: Reading
      readonly ref: SubscriptionRef.SubscriptionRef<Reading>
    }
  ) => Effect.Effect<A>
): Promise<{ readonly asked: ReadonlyArray<string>; readonly value: A }> => {
  const wire = recording(answer)
  const value = await Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const board = yield* Board
      const settings = yield* Settings
      yield* settings.change((held) => withAutomatic(held, true))
      const ref = yield* board.open(1)
      yield* board.sight(1, ADDRESS, TITLE, Arrival.cases.Elsewhere.make({}))
      const done = yield* SubscriptionRef.changes(ref).pipe(
        Stream.filter(settled),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("10 seconds")
      )
      const reading = done[0]
      if (reading === undefined) throw new Error("the Reading never settled")
      return yield* use({ board, reading, ref })
    })).pipe(Effect.provide(Pipeline.on(WebExt.doubleLayer(double), wire.layer)))
  )
  return { asked: wire.asked, value }
}

describe("a Lookup the previous worker lifetime died holding", () => {
  it("is not asked again inside the lease window, and the panel says so overridably", async () => {
    const double = makeDouble()
    await dieHolding(double, EVERY_ASK)

    const { asked, value } = await lifetime(double, algolia, ({ reading }) => Effect.succeed(reading))

    // The whole point: the same Subject, the same questions, and not one
    // request went out — the predecessor's budget is still being honoured.
    expect(asked.filter((url) => url.includes("hn.algolia.com"))).toHaveLength(0)
    expect(asked).toHaveLength(0)

    // And it is a Withholding, not a silence: rendered, reasoned, and the one
    // reason whose way out is "Look it up anyway".
    const network = consultationsOf(value).filter((c) => c.place._tag === "Network" && (c.place.network === "hackernews" || c.place.network === "reddit"))
    expect(network).toHaveLength(2)
    expect(network.every((c) => c._tag === "Withholding" && c.reason === "over-budget")).toBe(true)
  })

  it("is asked again the moment the reader insists — the gate never outranks them", async () => {
    const double = makeDouble()
    await dieHolding(double, EVERY_ASK)

    const { asked } = await lifetime(double, algolia, ({ board, ref }) =>
      Effect.gen(function*() {
        yield* board.insist(1)
        yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter((reading) =>
            consultationsOf(reading).some((c) =>
              c._tag === "Answered" && c.place._tag === "Network" && c.place.network === "hackernews"
            )),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout("10 seconds"),
          Effect.orDie
        )
      }))

    expect(asked.filter((url) => url.includes("hn.algolia.com")).length).toBeGreaterThan(0)
  })

  it("is asked again once the lease expires — a crash costs one window, not the feature", async () => {
    const double = makeDouble()
    await dieHolding(double, EVERY_ASK, { ...defaultRetention, lease: Duration.millis(1) })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const { asked } = await lifetime(double, algolia, () => Effect.void)

    expect(asked.filter((url) => url.includes("hn.algolia.com")).length).toBeGreaterThan(0)
  })
})

describe("what a settled lifetime leaves on disk", () => {
  it("keeps answers, drops refusals, and never withholds on a settled answer", async () => {
    const double = makeDouble()

    // Lifetime one settles normally: Hacker News answers, Reddit 403s.
    const first = await lifetime(double, algolia, () => Effect.void)
    expect(first.asked.filter((url) => url.includes("hn.algolia.com")).length).toBeGreaterThan(0)

    // Hacker News's answer persists; Reddit's refusal is removed — a Refusal
    // is a fact about the attempt and is never cached.
    const held = await Effect.runPromise(
      Effect.gen(function*() {
        const bytes = yield* Bytes
        return (yield* bytes.keys).filter((key) => key.startsWith("parle/lookup/"))
      }).pipe(Effect.provide(Bytes.layer.pipe(Layer.provide(WebExt.doubleLayer(double)))))
    )
    expect(held).toHaveLength(1)

    // Lifetime two, same disk, same Subject: the settled answers do NOT gate.
    // This worker cannot re-render Mentions it never fetched, so a skip here
    // would be ADR 0005's durable false negative — it must ask again.
    const second = await lifetime(double, algolia, () => Effect.void)
    expect(second.asked.filter((url) => url.includes("hn.algolia.com")).length).toBeGreaterThan(0)
  })
})
