/**
 * The service surface, and the shape of what it refuses to say.
 *
 * The interesting assertions here are negative ones: there is no method that
 * returns a decision, there is no boolean anywhere on a `Hint`, and an index
 * that holds nothing is a first-class state rather than a failure. Those are
 * the properties ADR 0005 and ADR 0011 actually turn on, and they are easy to
 * lose to a convenience helper added six months from now.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SubjectUrl } from "@parle/domain/Subject"
import { buildFilter } from "./Build.ts"
import { DiscussionIndex } from "./DiscussionIndex.ts"
import { Shelf, type Offer } from "./Shelf.ts"

const corpus = Array.from({ length: 500 }, (_, i) => `https://example.com/story/${i}`)

const offer = (): Offer => {
  const built = buildFilter(corpus)
  return {
    manifest: {
      schemaVersion: 1,
      generation: "2026-08-01T00:00:00Z",
      canonicalizerVersion: "1",
      filters: {
        hackernews: {
          kind: "binary-fuse",
          fingerprintBits: 8,
          serializationVersion: 1,
          keyCount: corpus.length,
          url: "/v1/blobs/hn.bin",
          sha256: built.sha256
        }
      }
    },
    filters: [{ network: "hackernews", sha256: built.sha256, bytes: built.bytes }]
  }
}

const asSubject = (url: string): SubjectUrl => SubjectUrl.make(url)

const live = DiscussionIndex.layer.pipe(Layer.provideMerge(Shelf.layerFor("1")))

describe("DiscussionIndex", () => {
  it("suspects a Subject the artifact was built from", () =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function*() {
          const shelf = yield* Shelf
          const index = yield* DiscussionIndex
          yield* shelf.offer(offer())

          const hint = yield* index.hint(asSubject(corpus[7] ?? ""))
          expect(hint._tag).toBe("Possible")
          if (hint._tag === "Possible") expect([...hint.networks]).toEqual(["hackernews"])
        }),
        live
      )
    ))

  it("says NoIndex — not NotListed — before anything has been adopted", () =>
    // The distinction the stress tests forced. "We hold no index" and "the
    // index does not list this" license the same behaviour and need different
    // words, and a client that cannot tell them apart writes one sentence for
    // both.
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function*() {
          const index = yield* DiscussionIndex
          expect((yield* index.hint(asSubject(corpus[0] ?? "")))._tag).toBe("NoIndex")
          expect((yield* index.state)._tag).toBe("Absent")
        }),
        live
      )
    ))

  it("still says NoIndex after a canonicalizer mismatch, having adopted nothing", () =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function*() {
          const shelf = yield* Shelf
          const index = yield* DiscussionIndex
          const mismatched = offer()
          yield* shelf.offer({
            ...mismatched,
            manifest: { ...mismatched.manifest, canonicalizerVersion: "7" }
          })

          // Every Subject, including ones that are certainly in the filter.
          expect((yield* index.hint(asSubject(corpus[0] ?? "")))._tag).toBe("NoIndex")
          const state = yield* index.state
          expect(state._tag).toBe("Refused")
          if (state._tag === "Refused") expect(state.rejection).toBe("canonicalizer-mismatch")
        }),
        live
      )
    ))

  it("never answers from a filter built under other rules, even where it would answer WRONG", () =>
    // The test above proves nothing is adopted; this one proves what that is
    // worth. Rules version 2 strips tracking parameters and version 1 does not,
    // so a v2 filter holds `…/x` where a v1 client asks about `…/x?utm_source=…`
    // — different strings, different SHA-256, different key. Probing anyway
    // returns NotListed for a page that IS in the filter: a silent false
    // negative, invisible to the reader, which is the single failure a
    // membership filter is supposed to make impossible and the entire reason
    // the version travels in the manifest.
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function*() {
          const shelf = yield* Shelf
          const index = yield* DiscussionIndex

          const electedByV2 = corpus // v2 strips the tracking parameter
          const asReadByV1 = corpus.map((url) => `${url}?utm_source=hackernews`)
          const builtUnderV2 = buildFilter(electedByV2)

          const state = yield* shelf.offer({
            manifest: {
              schemaVersion: 1,
              generation: "2026-08-01T00:00:00Z",
              canonicalizerVersion: "2",
              filters: {
                hackernews: {
                  kind: "binary-fuse",
                  fingerprintBits: 8,
                  serializationVersion: 1,
                  keyCount: electedByV2.length,
                  url: "/v1/blobs/hn.bin",
                  sha256: builtUnderV2.sha256
                }
              }
            },
            filters: [{ network: "hackernews", sha256: builtUnderV2.sha256, bytes: builtUnderV2.bytes }]
          })
          expect(state._tag).toBe("Refused")

          // Had the mismatch been tolerated, every one of these would have come
          // back NotListed while a Discussion sat behind it. Refusing turns all
          // of them into NoIndex, which licenses nothing and hides nothing.
          for (const url of asReadByV1.slice(0, 50)) {
            expect((yield* index.hint(asSubject(url)))._tag, url).toBe("NoIndex")
          }
        }),
        live
      )
    ))

  it("keeps answering from last-known-good while reporting itself stale", () =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function*() {
          const shelf = yield* Shelf
          const index = yield* DiscussionIndex
          yield* shelf.offer(offer())
          yield* shelf.offer({ manifest: "not a manifest", filters: [] })

          expect((yield* index.hint(asSubject(corpus[3] ?? "")))._tag).toBe("Possible")
          expect((yield* index.state)._tag).toBe("Stale")
        }),
        live
      )
    ))

  it("exposes exactly two members, neither of which is a decision", () =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function*() {
          const index = yield* DiscussionIndex
          // If this ever grows a `has`, a `contains` or a `shouldLookUp`, the
          // index has quietly become a gate and ADR 0005's argument no longer
          // holds. Promoting it is a deliberate act — a fourth `Hint`
          // constructor, breaking every match site — not a new method.
          expect(Object.keys(index).sort()).toEqual(["hint", "state"])
        }),
        DiscussionIndex.absent
      )
    ))

  it("has an absent layer, because no backend deployed is a supported configuration", () =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function*() {
          const index = yield* DiscussionIndex
          expect((yield* index.hint(asSubject("https://example.com/story/1")))._tag).toBe("NoIndex")
          expect((yield* index.state)._tag).toBe("Absent")
        }),
        DiscussionIndex.absent
      )
    ))

  it("cannot express 'this Subject has no Discussions', in any state it can be in", () =>
    // The one thing the glossary forbids the index to say. Checking a single
    // Hint's keys is not enough — the claim is about the whole reachable
    // surface — so this walks every state the index can be in, over Subjects in
    // the corpus and outside it, and asserts that every answer is one of the
    // three permitted tags and that not one of them carries a field a caller
    // could read as "no". A `Possible` names Networks that suspect; it never
    // names Networks that have ruled the Subject out, which is the shape a
    // fourth field would quietly introduce.
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function*() {
          const shelf = yield* Shelf
          const index = yield* DiscussionIndex
          const probes = [...corpus.slice(0, 20), ...Array.from(
            { length: 20 },
            (_, i) => `https://nowhere.test/absent/${i}`
          )]

          const states = [
            ["Absent", Effect.void],
            ["Serving", shelf.offer(offer()).pipe(Effect.asVoid)],
            ["Stale", shelf.offer({ manifest: "not a manifest", filters: [] }).pipe(Effect.asVoid)],
            ["Refused", shelf.discard.pipe(
              Effect.andThen(shelf.offer({ manifest: "not a manifest", filters: [] })),
              Effect.asVoid
            )]
          ] as const

          for (const [label, arrive] of states) {
            yield* arrive
            expect((yield* index.state)._tag, label).toBe(label)
            for (const url of probes) {
              const hint = yield* index.hint(asSubject(url))
              expect(["Possible", "NotListed", "NoIndex"], `${label} ${url}`).toContain(hint._tag)
              // Nothing on a Hint may be read as a negative claim about the
              // world: `Possible` carries suspicion and ordering, the other two
              // carry nothing at all.
              const fields = Object.keys(hint).filter((key) => key !== "_tag")
              expect(fields, `${label} ${url}`).toEqual(hint._tag === "Possible" ? ["networks"] : [])
              if (hint._tag === "Possible") expect(hint.networks.length).toBeGreaterThan(0)
            }
          }
        }),
        live
      )
    ))

  it("is optional: consulting it adds nothing to a caller's requirements", () =>
    // ADR 0011 as a compile-time fact. `Effect.serviceOption` has `R = never`,
    // so a client that reaches for the index this way provably still builds
    // when there is no backend at all — which is why this test provides no
    // layer whatsoever.
    Effect.runPromise(
      Effect.gen(function*() {
        const maybe = yield* Effect.serviceOption(DiscussionIndex)
        expect(maybe._tag).toBe("None")
      })
    ))

  it("builds standalone from a canonicalizer version", () =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function*() {
          const index = yield* DiscussionIndex
          expect((yield* index.state)._tag).toBe("Absent")
        }),
        DiscussionIndex.layerFor("1")
      )
    ))
})
