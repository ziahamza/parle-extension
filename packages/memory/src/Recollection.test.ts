/**
 * Recollection's promises, each of which fails silently if it is wrong: a cache
 * hit carries its own tier, a Mention with no destination is never stored, a
 * merge repairs rows already written under a superseded address, and a store that
 * cannot be written takes nothing down with it.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { AliasEvidence, SubjectUrl } from "@parle/domain/Subject"
import { type Claim, observed } from "./Merge.ts"
import { Observation } from "./Observation.ts"
import { Recollection } from "./Recollection.ts"
import { Storage, StorageUnavailable } from "./Storage.ts"

const subjectA = SubjectUrl.make("https://example.com/a")
const subjectB = SubjectUrl.make("https://other.test/b")

/** The address a publisher's slug change left behind, and the one it moved to. */
const oldSlug = SubjectUrl.make("https://example.com/2019/the-unwind-was-orderly")
const newSlug = SubjectUrl.make("https://example.com/2019/the-unwind")

/** A redirect the reader's own browser traversed. Evidence, per ADR 0015. */
const traversed = AliasEvidence.cases.Redirected.make({ from: oldSlug })

/**
 * Merge only on what a Claim actually evidences.
 *
 * The whole point of routing through `observed` in a test is that a Claim the
 * ADR refuses cannot reach `merge` at all — there is no evidence to pass it.
 */
const mergeOnClaim = (
  recollection: Recollection["Service"],
  into: SubjectUrl,
  from: SubjectUrl,
  claim: Claim
) => {
  const evidence = observed(claim)
  return Option.isSome(evidence) ? recollection.merge(into, from, evidence.value) : Effect.void
}

const hn = (id: string) => DiscussionId.make({ network: "hackernews", nativeId: NativeId.make(id) })

const linked = (subject: SubjectUrl, id: string) =>
  Mention.cases.Linked.make({ subject, discussion: hn(id), viaAlias: subject })

const topical = (subject: SubjectUrl, id: string) =>
  Mention.cases.Topical.make({ subject, discussion: hn(id), matchedTitle: "A" })

const passing = (subject: SubjectUrl, id: string) =>
  Mention.cases.Passing.make({ subject, discussion: hn(id) })

const withRecollection = <A>(
  storage: Layer.Layer<Storage>,
  use: (recollection: Recollection["Service"]) => Effect.Effect<A>
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function*() {
      return yield* use(yield* Recollection)
    }).pipe(Effect.provide(Layer.provide(Recollection.layer, storage)))
  )

const collect = (recollection: Recollection["Service"], subject: SubjectUrl) =>
  Stream.runCollect(recollection.recall(subject))

describe("a cache hit carries its own tier", () => {
  it("recalls a Linked Mention as a Linked Mention, evidence intact", async () => {
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(subjectA, "41293011")])
        return yield* collect(recollection, subjectA)
      }))

    expect(recalled).toHaveLength(1)
    const only = recalled[0]
    expect(only?._tag).toBe("Linked")
    // The panel is never asked to decide a tier, so the evidence has to survive
    // the round trip along with it.
    expect(only?._tag === "Linked" ? only.viaAlias : undefined).toBe(subjectA)
  })

  it("keeps Mentions of one Subject out of another's", async () => {
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(subjectA, "1"), linked(subjectB, "2")])
        return yield* collect(recollection, subjectB)
      }))

    expect(recalled).toHaveLength(1)
    expect(recalled[0]?.discussion.nativeId).toBe("2")
  })
})

describe("a Mention with no Subject URL is refused", () => {
  it("stores nothing at all", async () => {
    // ADR 0012's rule is "key on the resolved destination, never the tracking
    // URL". A harvest whose t.co never resolved has no destination — storing it
    // under an empty key would not be a weak Mention, it would be a Mention of
    // the wrong page.
    const backing = new Map<string, string>()
    await withRecollection(Storage.memory(backing), (recollection) =>
      recollection.remember([linked(SubjectUrl.make(""), "41293011")]))

    expect(Array.from(backing.keys()).filter((k) => k.startsWith("parle/recollection/"))).toEqual([])
  })

  it("still stores the usable Mentions alongside it", async () => {
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(SubjectUrl.make("   "), "1"), linked(subjectA, "2")])
        return yield* collect(recollection, subjectA)
      }))

    expect(recalled).toHaveLength(1)
  })
})

describe("a weaker tier never displaces a stronger one", () => {
  it("does not let a later Topical Mention downgrade a stored Linked Mention", async () => {
    // A downgrade here is not cosmetic: the X gate reads the tier, so replacing
    // Linked with Topical silently closes a gate that was open.
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(subjectA, "41293011")])
        yield* recollection.remember([topical(subjectA, "41293011")])
        return yield* collect(recollection, subjectA)
      }))

    expect(recalled).toHaveLength(1)
    expect(recalled[0]?._tag).toBe("Linked")
  })

  it("does let a later Linked Mention upgrade a stored Passing one", async () => {
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([passing(subjectA, "41293011")])
        yield* recollection.remember([linked(subjectA, "41293011")])
        return yield* collect(recollection, subjectA)
      }))

    expect(recalled).toHaveLength(1)
    expect(recalled[0]?._tag).toBe("Linked")
  })
})

describe("Observations are superseded, never corrected", () => {
  const at = (receivedAt: number, score: number) =>
    Observation.make({ discussion: hn("41293011"), score, stillListed: true, receivedAt })

  it("does not let a late-arriving older reading walk the numbers backwards", async () => {
    const held = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.observe([at(2_000, 1859)])
        yield* recollection.observe([at(1_000, 12)])
        return yield* recollection.latest(hn("41293011"))
      }))

    expect(Option.isSome(held)).toBe(true)
    expect(Option.isSome(held) ? held.value.score : undefined).toBe(1859)
  })

  it("accepts a newer reading", async () => {
    const held = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.observe([at(1_000, 12)])
        yield* recollection.observe([at(2_000, 1859)])
        return yield* recollection.latest(hn("41293011"))
      }))

    expect(Option.isSome(held) ? held.value.score : undefined).toBe(1859)
  })
})

describe("a merge repairs rows already stored under a superseded address", () => {
  it("hands back, under the new address, a Mention stored under the old one", async () => {
    // The failure this prevents: a 640-point thread harvested yesterday under
    // the slug the publisher changed today. Without re-keying it is not lost,
    // it is *unfindable* — and nothing anywhere reports it missing.
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(oldSlug, "41293011")])
        yield* recollection.merge(newSlug, oldSlug, traversed)
        return yield* collect(recollection, newSlug)
      }))

    expect(recalled).toHaveLength(1)
    expect(recalled[0]?.subject).toBe(newSlug)
    expect(recalled[0]?._tag).toBe("Linked")
  })

  it("keeps the evidence that made it a Linked Mention", async () => {
    // `viaAlias` records the address the Discussion actually submitted. That
    // stays true however the Subject is re-keyed, and rewriting it would turn
    // the evidence for the strong tier into a restatement of the key.
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(oldSlug, "41293011")])
        yield* recollection.merge(newSlug, oldSlug, traversed)
        return yield* collect(recollection, newSlug)
      }))

    const only = recalled[0]
    expect(only?._tag === "Linked" ? only.viaAlias : undefined).toBe(oldSlug)
  })

  it("still answers when the reader arrives by the old address", async () => {
    // A bookmark, an old Discussion, a syndicated copy. A merge that made the
    // old address stop answering would have introduced exactly the orphaning it
    // exists to repair.
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(oldSlug, "41293011")])
        yield* recollection.merge(newSlug, oldSlug, traversed)
        return yield* collect(recollection, oldSlug)
      }))

    expect(recalled).toHaveLength(1)
    expect(recalled[0]?.subject).toBe(newSlug)
  })

  it("files a later harvest of the old address into the merged row", async () => {
    // Otherwise `merge` repairs the past and the next Harvest breaks it again.
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.merge(newSlug, oldSlug, traversed)
        yield* recollection.remember([linked(oldSlug, "41293011")])
        return yield* collect(recollection, newSlug)
      }))

    expect(recalled).toHaveLength(1)
    expect(recalled[0]?.subject).toBe(newSlug)
  })

  it("collapses the two rows rather than double-counting the Discussion", async () => {
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(oldSlug, "41293011")])
        yield* recollection.remember([linked(newSlug, "41293011")])
        yield* recollection.merge(newSlug, oldSlug, traversed)
        return yield* collect(recollection, newSlug)
      }))

    expect(recalled).toHaveLength(1)
  })

  it("is safe to repeat, and safe to run backwards afterwards", async () => {
    // A merge is retried by a worker that died mid-way, and the reverse
    // direction arrives from a second tab that saw the redirect the other way
    // round. Both must be no-ops, not a cycle the next read walks forever.
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(oldSlug, "41293011")])
        yield* recollection.merge(newSlug, oldSlug, traversed)
        yield* recollection.merge(newSlug, oldSlug, traversed)
        yield* recollection.merge(oldSlug, newSlug, traversed)
        return {
          viaNew: yield* collect(recollection, newSlug),
          viaOld: yield* collect(recollection, oldSlug),
          elected: yield* recollection.elect(oldSlug)
        }
      }))

    expect(recalled.viaNew).toHaveLength(1)
    expect(recalled.viaOld).toHaveLength(1)
    expect(recalled.elected).toBe(newSlug)
  })

  it("follows a chain of merges to whichever address is elected now", async () => {
    const elected = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(subjectA, "41293011")])
        yield* recollection.merge(oldSlug, subjectA, traversed)
        yield* recollection.merge(newSlug, oldSlug, traversed)
        return {
          elected: yield* recollection.elect(subjectA),
          recalled: yield* collect(recollection, subjectA)
        }
      }))

    expect(elected.elected).toBe(newSlug)
    expect(elected.recalled).toHaveLength(1)
  })

  it("follows a chain longer than a page's address history is ever likely to be", async () => {
    // A merge deletes the source row as it forwards, so every address in the
    // middle of a chain holds nothing. Giving up part-way therefore does not
    // return a stale answer, it returns an *empty* one — the reader arrives by
    // the address they had and the panel says the page has no Discussions. That
    // is the silent false negative the merge mechanism exists to prevent,
    // produced by the mechanism's own guard, and nothing anywhere reports it.
    const chain = Array.from({ length: 20 }, (_, i) => SubjectUrl.make(`https://example.com/slug-${i}`))
    const seen = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(chain[0]!, "41293011")])
        for (let i = 0; i < chain.length - 1; i++) {
          yield* recollection.merge(chain[i + 1]!, chain[i]!, traversed)
        }
        return {
          fromTheOldestAddress: yield* collect(recollection, chain[0]!),
          fromTheCurrentOne: yield* collect(recollection, chain[chain.length - 1]!),
          elected: yield* recollection.elect(chain[0]!)
        }
      }))

    expect(seen.fromTheOldestAddress).toHaveLength(1)
    expect(seen.fromTheCurrentOne).toHaveLength(1)
    expect(seen.elected).toBe(chain[chain.length - 1])
  })

  it("refuses a merge onto a blank address", async () => {
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(oldSlug, "41293011")])
        yield* recollection.merge(SubjectUrl.make("  "), oldSlug, traversed)
        return yield* collect(recollection, oldSlug)
      }))

    expect(recalled).toHaveLength(1)
    expect(recalled[0]?.subject).toBe(oldSlug)
  })
})

describe("a merge is safe to run while reads are in flight", () => {
  /** One write the merge performed, in the order it performed it. */
  interface Step {
    readonly op: "set" | "remove"
    readonly key: string
    readonly value?: string | undefined
  }

  /** `Storage.memory`, plus a tape of every mutation. */
  const recording = (backing: Map<string, string>, steps: Array<Step>): Layer.Layer<Storage> =>
    Layer.succeed(Storage)(Storage.of({
      get: (key) => Effect.sync(() => Option.fromNullishOr(backing.get(key))),
      set: (key, value) =>
        Effect.sync(() => {
          steps.push({ op: "set", key, value })
          backing.set(key, value)
        }).pipe(Effect.asVoid),
      remove: (key) =>
        Effect.sync(() => {
          steps.push({ op: "remove", key })
          backing.delete(key)
        }).pipe(Effect.asVoid),
      keys: (prefix) => Effect.sync(() => Array.from(backing.keys()).filter((k) => k.startsWith(prefix)))
    }))

  const answersAt = (state: ReadonlyMap<string, string>) =>
    withRecollection(Storage.memory(new Map(state)), (recollection) =>
      Effect.gen(function*() {
        return {
          viaOld: yield* collect(recollection, oldSlug),
          viaNew: yield* collect(recollection, newSlug)
        }
      }))

  it("never leaves either address answering with less than it did before", async () => {
    // The store has no transactions, so the *ordering* of the merge's three
    // writes is the entire safety argument. Replaying them one at a time and
    // reading after each is that argument, checked. Do it in the obvious order
    // instead — delete the old row, then write the new one — and this fails on
    // the first checkpoint: a Reading that landed on the old address gets an
    // empty panel, which is the orphaning the merge exists to prevent, merely
    // shortened to a few milliseconds.
    const backing = new Map<string, string>()
    await withRecollection(
      Storage.memory(backing),
      (recollection) => recollection.remember([linked(oldSlug, "41293011")])
    )

    const before = new Map(backing)
    const steps: Array<Step> = []
    await withRecollection(
      recording(backing, steps),
      (recollection) => recollection.merge(newSlug, oldSlug, traversed)
    )

    // Copy the target row, publish the pointer, drop the source row.
    expect(steps).toHaveLength(3)

    const replay = new Map(before)
    let answers = await answersAt(replay)
    expect(answers.viaOld).toHaveLength(1)

    for (const step of steps) {
      if (step.op === "set" && step.value !== undefined) replay.set(step.key, step.value)
      else replay.delete(step.key)
      answers = await answersAt(replay)
      expect(answers.viaOld).toHaveLength(1)
    }

    expect(answers.viaNew).toHaveLength(1)
  })
})

describe("a merge that cannot finish leaves both addresses standing", () => {
  /**
   * `Storage.memory`, but chosen operations refuse.
   *
   * The ordering argument above is only half of the merge's safety case, and it
   * is the half that was checked. Every step can also *fail* — and because this
   * package converts every storage failure into a logged nothing by design, a
   * failed step and a successful one reach the final `remove` by the same
   * control flow. Replaying a successful merge's writes can never see that: the
   * tape only ever contains writes that landed.
   */
  const refusing = (
    backing: Map<string, string>,
    refuseSet: (key: string) => boolean = () => false,
    refuseGet: (key: string) => boolean = () => false
  ): Layer.Layer<Storage> =>
    Layer.succeed(Storage)(Storage.of({
      get: (key) =>
        refuseGet(key)
          ? Effect.fail(new StorageUnavailable({ operation: "get", key, detail: "denied" }))
          : Effect.sync(() => Option.fromNullishOr(backing.get(key))),
      set: (key, value) =>
        refuseSet(key)
          ? Effect.fail(new StorageUnavailable({ operation: "set", key, detail: "quota exceeded" }))
          : Effect.sync(() => backing.set(key, value)).pipe(Effect.asVoid),
      remove: (key) => Effect.sync(() => backing.delete(key)).pipe(Effect.asVoid),
      keys: (prefix) => Effect.sync(() => Array.from(backing.keys()).filter((k) => k.startsWith(prefix)))
    }))

  /** One harvested Linked Mention under the address the publisher abandoned. */
  const harvested = async () => {
    const backing = new Map<string, string>()
    await withRecollection(
      Storage.memory(backing),
      (recollection) => recollection.remember([linked(oldSlug, "41293011")])
    )
    return backing
  }

  /** What the reader gets, arriving at each address, from the store as it now is. */
  const answersFrom = (backing: Map<string, string>) =>
    withRecollection(Storage.memory(backing), (recollection) =>
      Effect.gen(function*() {
        return {
          viaOld: yield* collect(recollection, oldSlug),
          viaNew: yield* collect(recollection, newSlug)
        }
      }))

  const sourceRow = `${"parle/recollection/mentions/"}${encodeURIComponent("https://example.com")}/${
    encodeURIComponent(oldSlug)
  }`
  const targetRow = `${"parle/recollection/mentions/"}${encodeURIComponent("https://example.com")}/${
    encodeURIComponent(newSlug)
  }`

  it("does not drop the source row when the copy could not be written", async () => {
    // Quota exceeded on the target write. iOS Safari extension storage is the
    // constraining platform and this is the failure it actually produces; the
    // merge would go on to delete the only remaining copy of the Mention it had
    // just failed to duplicate.
    const backing = await harvested()
    expect(backing.has(sourceRow)).toBe(true)

    await withRecollection(
      refusing(backing, (key) => key === targetRow),
      (recollection) => recollection.merge(newSlug, oldSlug, traversed)
    )

    const answers = await answersFrom(backing)
    expect(answers.viaOld).toHaveLength(1)
    expect(answers.viaOld[0]?.discussion.nativeId).toBe("41293011")
  })

  it("does not drop the source row when it could not be read", async () => {
    const backing = await harvested()

    await withRecollection(
      refusing(backing, () => false, (key) => key === sourceRow),
      (recollection) => recollection.merge(newSlug, oldSlug, traversed)
    )

    expect((await answersFrom(backing)).viaOld).toHaveLength(1)
  })

  it("does not drop a source row it could not decode", async () => {
    // A blob an older build wrote, or one a killed worker truncated. Deleting a
    // row because it did not decode is the same loss with a different cause, and
    // it is the one that arrives on its own with no storage failure at all.
    const backing = await harvested()
    backing.set(sourceRow, '[{"mention":{"_tag":"Linked"},"rememberedAt":1}]')

    await withRecollection(
      Storage.memory(backing),
      (recollection) => recollection.merge(newSlug, oldSlug, traversed)
    )

    expect(backing.get(sourceRow)).toBe('[{"mention":{"_tag":"Linked"},"rememberedAt":1}]')
  })

  it("does not orphan the old address when the pointer could not be published", async () => {
    // Worse than losing the copy: with no pointer written and the source row
    // dropped, the old address resolves to itself and holds nothing. That is
    // exactly the orphaning the merge exists to repair, produced by the merge.
    const backing = await harvested()

    await withRecollection(
      refusing(backing, (key) => key.startsWith("parle/recollection/alias/")),
      (recollection) => recollection.merge(newSlug, oldSlug, traversed)
    )

    expect((await answersFrom(backing)).viaOld).toHaveLength(1)
  })

  it("does not replace the target's own Mentions with only the source's", async () => {
    // The target row is read to be reconciled against. A read that failed reads
    // as an empty row, and the merge then writes the source's Mentions over the
    // target's — losing Mentions that had nothing to do with the merge.
    const backing = new Map<string, string>()
    await withRecollection(
      Storage.memory(backing),
      (recollection) => recollection.remember([linked(oldSlug, "1"), linked(newSlug, "2")])
    )

    await withRecollection(
      refusing(backing, () => false, (key) => key === targetRow),
      (recollection) => recollection.merge(newSlug, oldSlug, traversed)
    )

    const ids = (await answersFrom(backing)).viaNew.map((m) => m.discussion.nativeId).sort()
    expect(ids).toEqual(["2"])
    expect((await answersFrom(backing)).viaOld.map((m) => m.discussion.nativeId)).toEqual(["1"])
  })

  it("still merges when nothing refuses, so the guards are not just a disabled merge", async () => {
    const backing = await harvested()
    await withRecollection(
      refusing(backing),
      (recollection) => recollection.merge(newSlug, oldSlug, traversed)
    )

    const answers = await answersFrom(backing)
    expect(answers.viaNew).toHaveLength(1)
    expect(answers.viaOld).toHaveLength(1)
    expect(backing.has(sourceRow)).toBe(false)
  })
})

describe("an origin-scoped forget is not defeated by how the origin is spelled", () => {
  it("clears the site however the caller had the origin to hand", async () => {
    // `forget` returns `void` and cannot fail, so an origin spelled differently
    // from the one in the key clears nothing and reports that to nobody: the
    // reader is told their data is gone while it is still on disk. The three
    // spellings a caller actually has are a tab's full URL, an origin with a
    // trailing slash, and a bare hostname.
    for (const spelling of ["https://example.com", "https://example.com/", "https://example.com/a?b=c", "example.com"]) {
      const recalled = await withRecollection(Storage.memory(), (recollection) =>
        Effect.gen(function*() {
          yield* recollection.remember([linked(subjectA, "1"), linked(subjectB, "2")])
          yield* recollection.forget({ _tag: "Origin", origin: spelling })
          return {
            a: yield* collect(recollection, subjectA),
            b: yield* collect(recollection, subjectB)
          }
        }))

      expect(recalled.a, `cleared for ${spelling}`).toEqual([])
      expect(recalled.b, `kept for ${spelling}`).toHaveLength(1)
    }
  })
})

describe("a page's self-declared canonical merges nothing", () => {
  it("leaves both addresses exactly as they were", async () => {
    // A page asserting its own identity is a claim by the party with the most to
    // gain. If this ever passes, a publisher can attach every Discussion on
    // their site to whichever page they like.
    const seen = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(oldSlug, "41293011")])
        yield* mergeOnClaim(recollection, newSlug, oldSlug, { _tag: "SelfDeclared", declared: newSlug })
        return {
          viaNew: yield* collect(recollection, newSlug),
          viaOld: yield* collect(recollection, oldSlug),
          elected: yield* recollection.elect(oldSlug)
        }
      }))

    expect(seen.viaNew).toEqual([])
    expect(seen.viaOld).toHaveLength(1)
    expect(seen.viaOld[0]?.subject).toBe(oldSlug)
    expect(seen.elected).toBe(oldSlug)
  })

  it("merges on a redirect offered the same way, so the refusal is the claim and not the plumbing", async () => {
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(oldSlug, "41293011")])
        yield* mergeOnClaim(recollection, newSlug, oldSlug, { _tag: "Redirected", from: oldSlug })
        return yield* collect(recollection, newSlug)
      }))

    expect(recalled).toHaveLength(1)
  })
})

describe("forgetting", () => {
  it("clears one origin and leaves the rest standing", async () => {
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(subjectA, "1"), linked(subjectB, "2")])
        yield* recollection.forget({ _tag: "Origin", origin: "https://example.com" })
        return {
          a: yield* collect(recollection, subjectA),
          b: yield* collect(recollection, subjectB)
        }
      }))

    expect(recalled.a).toEqual([])
    expect(recalled.b).toHaveLength(1)
  })

  it("clears a merged Subject through the address it was merged away from", async () => {
    // "Forget this page" that leaves the page's Mentions under the address it
    // was merged into is a promise broken silently.
    const recalled = await withRecollection(Storage.memory(), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(oldSlug, "41293011")])
        yield* recollection.merge(newSlug, oldSlug, traversed)
        yield* recollection.forget({ _tag: "Subject", subject: oldSlug })
        return {
          viaNew: yield* collect(recollection, newSlug),
          viaOld: yield* collect(recollection, oldSlug)
        }
      }))

    expect(recalled.viaNew).toEqual([])
    expect(recalled.viaOld).toEqual([])
  })

  it("clears everything, which is the prominent action ADR 0015 keeps", async () => {
    const backing = new Map<string, string>()
    await withRecollection(Storage.memory(backing), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(subjectA, "1"), linked(subjectB, "2")])
        yield* recollection.observe([
          Observation.make({ discussion: hn("1"), stillListed: true, receivedAt: 1 })
        ])
        // The forwarding pointer a merge leaves behind is itself a record of a
        // page this machine knew about, so the prominent clear has to take it.
        yield* recollection.merge(newSlug, subjectA, traversed)
        yield* recollection.forget({ _tag: "All" })
      }))

    expect(Array.from(backing.keys()).filter((k) => k.startsWith("parle/recollection/"))).toEqual([])
  })
})

describe("a storage failure is swallowed, not propagated", () => {
  it("commits nothing and raises nothing", async () => {
    // The signature already says so — `remember` is Effect<void, never> — but the
    // implementation could still die rather than fail, and in MV3 the fiber it
    // would kill is the one holding the reader's Enquiry.
    const recalled = await withRecollection(Storage.unavailable("quota exceeded"), (recollection) =>
      Effect.gen(function*() {
        yield* recollection.remember([linked(subjectA, "41293011")])
        yield* recollection.observe([
          Observation.make({ discussion: hn("41293011"), stillListed: true, receivedAt: 1 })
        ])
        yield* recollection.merge(newSlug, subjectA, traversed)
        yield* recollection.forget({ _tag: "All" })
        return yield* collect(recollection, subjectA)
      }))

    expect(recalled).toEqual([])
  })
})
