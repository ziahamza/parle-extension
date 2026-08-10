/**
 * The two controls ADR 0015 requires to be offerable, and the difference between
 * them.
 *
 * The prominent one takes everything. The finer one takes the Lookup Record and
 * leaves Recollection standing — and that asymmetry is the whole reason the finer
 * control exists, so it is the thing worth asserting. A `forget` that quietly
 * cleared both would look identical on screen and cost the reader every harvested
 * Mention they had.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { SubjectUrl } from "@parle/domain/Subject"
import { Forget } from "./Forget.ts"
import { FrontDoorMemory } from "./FrontDoorMemory.ts"
import { LookupRecord } from "./LookupRecord.ts"
import { OpaqueKeys } from "./OpaqueKeys.ts"
import { Recollection } from "./Recollection.ts"
import { Storage } from "./Storage.ts"

const subject = SubjectUrl.make("https://example.com/a")
const elsewhere = SubjectUrl.make("https://other.test/b")

const linked = (of: SubjectUrl, id: string) =>
  Mention.cases.Linked.make({
    subject: of,
    discussion: DiscussionId.make({ network: "hackernews", nativeId: NativeId.make(id) }),
    viaAlias: of
  })

interface Stores {
  readonly forget: Forget["Service"]
  readonly recollection: Recollection["Service"]
  readonly record: LookupRecord["Service"]
}

const withStores = <A>(
  storage: Layer.Layer<Storage>,
  use: (stores: Stores) => Effect.Effect<A>
): Promise<A> => {
  const keys = Layer.provide(OpaqueKeys.layer, storage)
  const recollection = Layer.provide(Recollection.layer, storage)
  const record = Layer.provide(LookupRecord.layer, Layer.mergeAll(storage, keys))
  // The third store the prominent control has to reach: front-door judgements
  // are the same kind of thing as the Lookup Record — a site the reader opened,
  // under a concealed key — so "forget everything" has to take them too.
  const frontDoors = Layer.provide(FrontDoorMemory.layer(1), Layer.mergeAll(storage, keys))
  const stores = Layer.mergeAll(recollection, record, frontDoors)
  return Effect.runPromise(
    Effect.gen(function*() {
      return yield* use({
        forget: yield* Forget,
        recollection: yield* Recollection,
        record: yield* LookupRecord
      })
    }).pipe(Effect.provide(Layer.provideMerge(Layer.provide(Forget.layer, stores), stores)))
  )
}

/** Fill both stores, then run one control, then read both back. */
const afterForgetting = (use: (stores: Stores) => Effect.Effect<void>) =>
  withStores(Storage.memory(), (stores) =>
    Effect.gen(function*() {
      yield* stores.recollection.remember([linked(subject, "41293011"), linked(elsewhere, "2")])
      const one = yield* stores.record.intend(subject, "hackernews", "linked")
      const two = yield* stores.record.intend(elsewhere, "hackernews", "linked")
      yield* stores.record.settle(one, { _tag: "Silence" })
      yield* stores.record.settle(two, { _tag: "Silence" })

      yield* use(stores)

      return {
        recalled: yield* Stream.runCollect(stores.recollection.recall(subject)),
        recalledElsewhere: yield* Stream.runCollect(stores.recollection.recall(elsewhere)),
        asked: yield* stores.record.asked(subject, "hackernews", "linked"),
        askedElsewhere: yield* stores.record.asked(elsewhere, "hackernews", "linked")
      }
    }))

describe("the prominent control", () => {
  it("takes both stores", async () => {
    const seen = await afterForgetting((stores) => stores.forget.everything)

    expect(seen.recalled).toEqual([])
    expect(seen.recalledElsewhere).toEqual([])
    expect(Option.isNone(seen.asked)).toBe(true)
    expect(Option.isNone(seen.askedElsewhere)).toBe(true)
  })
})

describe("the finer control", () => {
  it("takes the Lookup Record and leaves the harvested Mentions standing", async () => {
    // The Lookup Record is the dated record of what the reader *visited*.
    // Recollection is built from links they *saw* on pages already loaded — it
    // was never the liability, and it is expensive to rebuild.
    const seen = await afterForgetting((stores) => stores.forget.lookupRecord)

    expect(seen.recalled).toHaveLength(1)
    expect(seen.recalledElsewhere).toHaveLength(1)
    expect(Option.isNone(seen.asked)).toBe(true)
    expect(Option.isNone(seen.askedElsewhere)).toBe(true)
  })
})

describe("the origin control", () => {
  it("takes one site out of both stores and leaves the other alone", async () => {
    const seen = await afterForgetting((stores) => stores.forget.origin("https://example.com"))

    expect(seen.recalled).toEqual([])
    expect(Option.isNone(seen.asked)).toBe(true)
    expect(seen.recalledElsewhere).toHaveLength(1)
    expect(Option.isSome(seen.askedElsewhere)).toBe(true)
  })
})

describe("a storage failure is swallowed, not propagated", () => {
  it("reports a cleared store rather than failing the control", async () => {
    // A reader who presses "forget everything" on a machine whose storage has
    // been revoked must not get an error dialog; there is nothing there to
    // clear, and the honest answer is that it is now empty.
    const asked = await withStores(Storage.unavailable("quota exceeded"), (stores) =>
      Effect.gen(function*() {
        yield* stores.forget.everything
        yield* stores.forget.lookupRecord
        yield* stores.forget.origin("https://example.com")
        return yield* stores.record.asked(subject, "hackernews", "linked")
      }))

    expect(Option.isNone(asked)).toBe(true)
  })
})
