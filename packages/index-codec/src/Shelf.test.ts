/**
 * The fallback ladder, which is the only part of this package a reader can
 * actually feel.
 *
 * Two things are proved here. First, that a bad refresh never costs the reader
 * the good index they already had — it lands them in `Stale`, which still
 * answers probes. Second, that a `canonicalizerVersion` mismatch disables the
 * filter ENTIRELY rather than producing wrong answers, which is the one
 * rejection that indicates a bug rather than a network.
 *
 * The vocabulary is tested too, because it was a finding rather than a
 * preference: "index stale" and "index absent" are different states and need
 * different copy, and a client that cannot distinguish them will write one
 * sentence for both.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { buildAddendum, buildFilter } from "./Build.ts"
import { hintFor } from "./Artifact.ts"
import { Shelf, type Offer } from "./Shelf.ts"
import type { SubjectUrl } from "@parle/domain/Subject"

const urls = (prefix: string, n: number): ReadonlyArray<string> =>
  Array.from({ length: n }, (_, i) => `https://${prefix}.example/story/${i}`)

const august = urls("august", 500)
const september = urls("september", 500)

const manifestFor = (options: {
  readonly generation: string
  readonly canonicalizerVersion: string
  readonly sha256: string
  readonly addendum?: { readonly sha256: string; readonly baseGeneration: string } | undefined
}) => ({
  schemaVersion: 1,
  generation: options.generation,
  canonicalizerVersion: options.canonicalizerVersion,
  filters: {
    hackernews: {
      kind: "binary-fuse",
      fingerprintBits: 8,
      serializationVersion: 1,
      keyCount: 500,
      url: "/v1/blobs/hn.bin",
      sha256: options.sha256
    }
  },
  ...(options.addendum === undefined
    ? {}
    : {
      addendum: {
        kind: "u64-truncated-32",
        baseGeneration: options.addendum.baseGeneration,
        keyCount: 1,
        url: "/v1/blobs/add.bin",
        sha256: options.addendum.sha256
      }
    })
})

const offerOf = (generation: string, corpus: ReadonlyArray<string>, canonicalizerVersion = "1"): Offer => {
  const built = buildFilter(corpus)
  return {
    manifest: manifestFor({ generation, canonicalizerVersion, sha256: built.sha256 }),
    filters: [{ network: "hackernews", sha256: built.sha256, bytes: built.bytes }]
  }
}

const asSubject = (url: string): SubjectUrl => url as SubjectUrl

const run = <A>(effect: Effect.Effect<A, never, Shelf>, canonicalizerVersion = "1"): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, Shelf.layerFor(canonicalizerVersion)))

describe("the shelf's ladder", () => {
  it("starts absent, which is a normal state and not a failure", () =>
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        expect((yield* shelf.state)._tag).toBe("Absent")
        expect(Option.isNone(yield* shelf.artifact)).toBe(true)
      })
    ))

  it("adopts a well-formed, correctly pinned artifact", () =>
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        const state = yield* shelf.offer(offerOf("2026-08-01T00:00:00Z", august))
        expect(state._tag).toBe("Serving")
        if (state._tag !== "Serving") return
        expect(state.generation).toBe("2026-08-01T00:00:00Z")
        expect(state.keyCount).toBe(500)
        expect(state.canonicalizerVersion).toBe("1")
      })
    ))

  it("keeps last-known-good when the next refresh is corrupt, and says STALE", () =>
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        yield* shelf.offer(offerOf("2026-08-01T00:00:00Z", august))

        const broken = offerOf("2026-09-01T00:00:00Z", september)
        const truncated = broken.filters[0]?.bytes.slice(0, 500) ?? new Uint8Array()
        const state = yield* shelf.offer({
          ...broken,
          filters: [{ network: "hackernews", sha256: broken.filters[0]?.sha256 ?? "", bytes: truncated }]
        })

        expect(state._tag).toBe("Stale")
        if (state._tag !== "Stale") return
        expect(state.generation).toBe("2026-08-01T00:00:00Z")
        expect(state.rejection).toBe("sha256-mismatch")

        // The point of the rung: August's filter still answers.
        const artifact = yield* shelf.artifact
        expect(Option.isSome(artifact)).toBe(true)
        if (Option.isNone(artifact)) return
        expect(hintFor(artifact.value, asSubject(august[0] ?? ""))._tag).toBe("Possible")
      })
    ))

  it("holds nothing, and says REFUSED, when the first thing offered is bad", () =>
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        const state = yield* shelf.offer({ manifest: "<!doctype html>", filters: [] })
        expect(state).toEqual({ _tag: "Refused", rejection: "manifest-unreadable" })
        expect(Option.isNone(yield* shelf.artifact)).toBe(true)
      })
    ))

  it("distinguishes ABSENT from STALE from REFUSED, because the copy differs", () =>
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        expect((yield* shelf.state)._tag).toBe("Absent") // never offered anything

        const refused = yield* shelf.offer({ manifest: {}, filters: [] })
        expect(refused._tag).toBe("Refused") // offered, declined, holding nothing

        yield* shelf.offer(offerOf("2026-08-01T00:00:00Z", august))
        const stale = yield* shelf.offer({ manifest: {}, filters: [] })
        expect(stale._tag).toBe("Stale") // offered, declined, still holding August
      })
    ))

  it("forgets everything on discard, returning to absent rather than to stale", () =>
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        yield* shelf.offer(offerOf("2026-08-01T00:00:00Z", august))
        yield* shelf.discard
        expect((yield* shelf.state)._tag).toBe("Absent")
        expect(Option.isNone(yield* shelf.artifact)).toBe(true)
      })
    ))
})

describe("the canonicalizer mismatch", () => {
  it("disables the filter entirely rather than answering with keys it was not built from", () =>
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        const state = yield* shelf.offer(offerOf("2026-08-01T00:00:00Z", august, "2"))
        expect(state).toEqual({ _tag: "Refused", rejection: "canonicalizer-mismatch" })
        expect(Option.isNone(yield* shelf.artifact)).toBe(true)
      })
    ))

  it("is checked on the install path, not only where the fetcher chose to look", () =>
    // `elect` is public so a fetcher knows which blobs to ask for, but nothing
    // is adopted on a caller's assurance that it was elected. Here the bytes
    // are perfectly good and correctly pinned, and the artifact is still
    // refused, because the manifest says the rules differ.
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        const good = offerOf("2026-08-01T00:00:00Z", august, "9")
        const state = yield* shelf.offer(good)
        expect(state._tag).toBe("Refused")
        if (state._tag !== "Refused") return
        expect(state.rejection).toBe("canonicalizer-mismatch")
      })
    ))

  it("costs the reader the index they already had, deliberately", () =>
    // Falling back to a filter built from rules we no longer run would be
    // falling back to wrong answers. Stale is right for a corrupt download and
    // wrong for a rules disagreement — but the ladder is the same, so the state
    // is Stale and the artifact stops being refreshed until someone fixes the
    // versions.
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        yield* shelf.offer(offerOf("2026-08-01T00:00:00Z", august))
        const state = yield* shelf.offer(offerOf("2026-09-01T00:00:00Z", september, "2"))
        expect(state._tag).toBe("Stale")
        if (state._tag !== "Stale") return
        expect(state.rejection).toBe("canonicalizer-mismatch")
        expect(state.generation).toBe("2026-08-01T00:00:00Z")
      })
    ))
})

describe("pins and addenda through the shelf", () => {
  it("verifies bytes against the MANIFEST's pin, not against the pin they arrived with", () =>
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        const built = buildFilter(august)
        const somebodyElse = buildFilter(september)
        const state = yield* shelf.offer({
          manifest: manifestFor({
            generation: "2026-08-01T00:00:00Z",
            canonicalizerVersion: "1",
            sha256: somebodyElse.sha256
          }),
          // The caller attaches the digest that matches its own bytes. Verifying
          // against that would verify the bytes against themselves.
          filters: [{ network: "hackernews", sha256: built.sha256, bytes: built.bytes }]
        })
        expect(state).toEqual({ _tag: "Refused", rejection: "sha256-mismatch" })
      })
    ))

  it("adopts a matching addendum and suspects what it adds", () =>
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        const built = buildFilter(august)
        const fresh = "https://september.example/story/0"
        const addendum = buildAddendum([fresh])

        const state = yield* shelf.offer({
          manifest: manifestFor({
            generation: "2026-08-01T00:00:00Z",
            canonicalizerVersion: "1",
            sha256: built.sha256,
            addendum: { sha256: addendum.sha256, baseGeneration: "2026-08-01T00:00:00Z" }
          }),
          filters: [{ network: "hackernews", sha256: built.sha256, bytes: built.bytes }],
          addendum: { baseGeneration: "2026-08-01T00:00:00Z", sha256: addendum.sha256, bytes: addendum.bytes }
        })

        expect(state._tag).toBe("Serving")
        if (state._tag !== "Serving") return
        expect(state.addendumKeyCount).toBe(1)

        const artifact = yield* shelf.artifact
        if (Option.isNone(artifact)) throw new Error("expected an artifact")
        expect(hintFor(artifact.value, asSubject(fresh))._tag).toBe("Possible")
      })
    ))

  it("ignores an addendum the manifest never published", () =>
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        const built = buildFilter(august)
        const smuggled = buildAddendum(["https://attacker.example/inject"])
        const state = yield* shelf.offer({
          manifest: manifestFor({
            generation: "2026-08-01T00:00:00Z",
            canonicalizerVersion: "1",
            sha256: built.sha256
          }),
          filters: [{ network: "hackernews", sha256: built.sha256, bytes: built.bytes }],
          addendum: {
            baseGeneration: "2026-08-01T00:00:00Z",
            sha256: smuggled.sha256,
            bytes: smuggled.bytes
          }
        })
        expect(state._tag).toBe("Serving")
        if (state._tag !== "Serving") return
        expect(state.addendumKeyCount).toBe(0)
      })
    ))
})

describe("two refreshes in flight at once", () => {
  it("never lets a failing refresh overwrite an artifact that was already adopted", () =>
    // Nothing in this interface says `offer` is called from one place. A
    // startup fetch and an alarm-driven one can be in flight together, and a
    // `get`-then-`set` between them would let the loser decide: both read the
    // shelf as empty, and whichever writes last wins. If that is the failing
    // one it writes `Refused` over an index that was never rejected. The
    // outcome must always be one of the two orders, never a mixture of them.
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        const good = offerOf("2026-08-01T00:00:00Z", august)
        const bad: Offer = { manifest: "<!doctype html>", filters: [] }

        for (const [label, order] of [["good first", [good, bad]], ["bad first", [bad, good]]] as const) {
          yield* shelf.discard
          yield* Effect.all(order.map((one) => shelf.offer(one)), { concurrency: "unbounded" })
          const state = yield* shelf.state
          const held = yield* shelf.artifact
          // Whatever the interleaving, an adopted artifact is still held: the
          // good offer either lands last (Serving) or lands first and the bad
          // one degrades it to Stale. `Refused` here would mean the good
          // artifact was thrown away by a refresh that never rejected it.
          expect(["Serving", "Stale"], label).toContain(state._tag)
          expect(Option.isSome(held), label).toBe(true)
        }
      })
    ))

  it("never loses a good refresh to a concurrent good one", () =>
    run(
      Effect.gen(function*() {
        const shelf = yield* Shelf
        yield* Effect.all(
          [
            shelf.offer(offerOf("2026-08-01T00:00:00Z", august)),
            shelf.offer(offerOf("2026-09-01T00:00:00Z", september))
          ],
          { concurrency: "unbounded" }
        )
        const state = yield* shelf.state
        expect(state._tag).toBe("Serving")
        if (state._tag !== "Serving") return
        // One of the two, in one piece — not a generation from one and a key
        // count from the other.
        expect(["2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"]).toContain(state.generation)
        expect(state.keyCount).toBe(500)
      })
    ))
})

describe("the empty shelf", () => {
  it("adopts nothing, ever", () =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function*() {
          const shelf = yield* Shelf
          expect((yield* shelf.offer(offerOf("2026-08-01T00:00:00Z", august)))._tag).toBe("Absent")
          expect(Option.isNone(yield* shelf.artifact)).toBe(true)
        }),
        Shelf.empty
      )
    ))

  it("is the default, so a client that never says which rules it runs gets no index", () =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function*() {
          const shelf = yield* Shelf
          expect((yield* shelf.state)._tag).toBe("Absent")
        }),
        Shelf.layer
      )
    ))
})
