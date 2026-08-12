/**
 * Where the client keeps its copy of the index, and the ladder it falls down.
 *
 * The rule this module exists to implement, from ADR 0005 and ticket 13: **a
 * corrupt, unpinnable or misversioned artifact falls back to last-known-good,
 * and failing that to no index at all.** Never to a guess, never to an
 * exception reaching a caller, and never to probing something we cannot vouch
 * for.
 *
 * Three rungs:
 *
 * 1. Adopt the offered artifact — `Serving`.
 * 2. Keep the one we already had, and record why the new one was refused —
 *    `Stale`. A month-old filter is a perfectly good filter that merely lacks a
 *    month of URLs, and lacking them costs a Lookup we were going to make
 *    anyway. Discarding it because today's download was truncated would be
 *    strictly worse for the reader than keeping it.
 * 3. Hold nothing — `Refused`, which licenses exactly what `Absent` licenses
 *    and is distinguished only so the client can say which happened.
 *
 * **The election is re-run here, on the shelf's own inputs.** `elect` is public
 * because the fetcher has to know which blobs to ask for before it has any
 * bytes; but nothing is adopted on a caller's assurance that it was elected.
 * The canonicalizer check in particular is the guard whose failure is
 * invisible, so it runs on the path that actually installs the artifact, over
 * the manifest as it was served rather than over a caller's reading of it.
 *
 * The shelf holds the client's own canonicalizer version because that is a
 * property of the build, not of any call. `@parle/policy` owns the rules and
 * exports their number; the integrator renders it and hands it in, which is how
 * this package depends on `@parle/domain` and nothing else.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import {
  addendumKeyCountOf,
  decodeArtifact,
  keyCountOf,
  type Artifact,
  type OfferedAddendum,
  type OfferedFilter
} from "./Artifact.ts"
import { IndexState, type Rejection } from "./IndexState.ts"
import { elect, readManifest } from "./Manifest.ts"
import { isString } from "@parle/domain/Refine"

/**
 * A complete refresh: the manifest as it was served, and the bytes fetched for it.
 *
 * The manifest arrives as `unknown` deliberately. It is a JSON document off the
 * network, and the failure to avoid is a caller decoding it loosely, handing
 * over a shape that typechecks, and the `canonicalizerVersion` never actually
 * being compared with anything.
 *
 * The digests on the offered blobs are ignored: the pin that is checked is
 * always the one in the manifest. Verifying bytes against a digest that
 * travelled with the same bytes verifies nothing.
 */
export interface Offer {
  readonly manifest: unknown
  readonly filters: ReadonlyArray<OfferedFilter>
  readonly addendum?: OfferedAddendum | undefined
}

/** What the shelf holds, if anything, and what state that puts it in. */
export interface Holding {
  readonly artifact: Option.Option<Artifact>
  readonly state: IndexState
}

/** A shelf that has never been offered anything. Where every client starts. */
export const nothingHeld: Holding = { artifact: Option.none(), state: IndexState.cases.Absent.make({}) }

const adopted = (artifact: Artifact): Holding => ({
  artifact: Option.some(artifact),
  state: IndexState.cases.Serving.make({
    generation: artifact.generation,
    canonicalizerVersion: artifact.canonicalizerVersion,
    keyCount: keyCountOf(artifact),
    addendumKeyCount: addendumKeyCountOf(artifact)
  })
})

/**
 * The ladder, in one expression, in one place — so that no rejection path added
 * later can quietly forget to descend it.
 */
const refuse = (held: Holding, rejection: Rejection): Holding =>
  Option.isSome(held.artifact)
    ? {
      artifact: held.artifact,
      state: IndexState.cases.Stale.make({
        generation: held.artifact.value.generation,
        canonicalizerVersion: held.artifact.value.canonicalizerVersion,
        keyCount: keyCountOf(held.artifact.value),
        addendumKeyCount: addendumKeyCountOf(held.artifact.value),
        rejection
      })
    }
    : { artifact: Option.none(), state: IndexState.cases.Refused.make({ rejection }) }

/**
 * Work out what this offer amounts to, without touching any state.
 *
 * Pure, so the whole ladder is testable as a function and the service is only
 * the `Ref` around it.
 */
export const consider = (held: Holding, incoming: Offer, clientCanonicalizerVersion: string): Holding => {
  const manifest = readManifest(incoming.manifest)
  if (isString(manifest)) return refuse(held, manifest)

  const election = elect(manifest, clientCanonicalizerVersion)
  if (election._tag === "Ignore") return refuse(held, election.rejection)

  const offeredByNetwork = new Map(incoming.filters.map((filter) => [filter.network, filter]))
  const paired: Array<OfferedFilter> = []
  for (const elected of election.filters) {
    const bytes = offeredByNetwork.get(elected.network)
    if (bytes !== undefined) paired.push({ ...bytes, sha256: elected.filter.sha256 })
  }
  if (paired.length === 0) return refuse(held, "no-filter-published")

  const addendum =
    Option.isSome(election.addendum) && incoming.addendum !== undefined
      ? {
        bytes: incoming.addendum.bytes,
        sha256: election.addendum.value.sha256,
        baseGeneration: election.addendum.value.baseGeneration
      }
      : undefined

  const decoded = decodeArtifact({
    generation: manifest.generation,
    canonicalizerVersion: manifest.canonicalizerVersion,
    filters: paired,
    addendum
  })
  return isString(decoded) ? refuse(held, decoded) : adopted(decoded)
}

/**
 * The client's copy of the Discussion Index, and the ladder that maintains it.
 *
 * `offer` returns the resulting {@link IndexState} rather than succeeding or
 * failing, because every outcome here is a normal one. A refused artifact is
 * not an error condition — it is a flaky connection on a Tuesday, and the
 * reader is not owed an exception for it.
 */
export class Shelf extends Context.Service<Shelf, {
  /** Install a refresh, or fall back. Total: never fails, never throws. */
  readonly offer: (offer: Offer) => Effect.Effect<IndexState>
  /** What is currently held, for probing. */
  readonly artifact: Effect.Effect<Option.Option<Artifact>>
  /** What state the client's copy is in. This is what the reader-facing copy is written from. */
  readonly state: Effect.Effect<IndexState>
  /** Forget everything held — the reader clearing storage, or a rules-version bump. */
  readonly discard: Effect.Effect<void>
}>()("parle/backend/Shelf") {
  /**
   * A shelf for a client running a given version of the canonicalization rules.
   *
   * The version is a string because that is what the manifest carries, and
   * exact string equality is the entire check: no ranges, no compatibility
   * window, no "close enough". `@parle/policy`'s `rulesVersion` renders as its
   * decimal string.
   */
  static readonly layerFor = (clientCanonicalizerVersion: string): Layer.Layer<Shelf> =>
    Layer.effect(Shelf)(
      Effect.gen(function*() {
        const holding = yield* Ref.make(nothingHeld)

        // ONE atomic step, not `get` then `set`.
        //
        // The ladder's whole promise is that a bad refresh never costs the
        // reader the good index they already had — and a read-modify-write
        // spanning two effects cannot keep it. Two refreshes in flight at once
        // (a startup fetch and an alarm-driven one; nothing in this interface
        // forbids it) both read the shelf as empty, and whichever writes last
        // decides. If that is the failing one, it writes `Refused` over an
        // artifact that was successfully adopted a moment earlier, and the
        // reader loses an index that was never rejected.
        //
        // Today `consider` is synchronous and the two effects happen to run
        // without an interleaving point between them, so the window is shut by
        // accident rather than by design. It opens the first time anyone adds a
        // `yield*` in here — persisting the bytes to the Cache API is the
        // obvious one — and it opens silently, with no type error and no
        // failing test. `Ref.modify` closes it by construction.
        const offer = Effect.fn("Shelf.offer")(function*(incoming: Offer) {
          return yield* Ref.modify(holding, (held) => {
            const next = consider(held, incoming, clientCanonicalizerVersion)
            return [next.state, next]
          })
        })

        return Shelf.of({
          offer,
          artifact: Ref.get(holding).pipe(Effect.map((current) => current.artifact)),
          state: Ref.get(holding).pipe(Effect.map((current) => current.state)),
          discard: Ref.set(holding, nothingHeld)
        })
      })
    )

  /**
   * A shelf that holds nothing and adopts nothing.
   *
   * Not only a test double. ADR 0011 makes "no backend deployed" a supported
   * configuration rather than a degraded one, so this is a first-class state:
   * a build compiled without an index origin, or a reader who turned the index
   * off, gets exactly this and everything downstream carries on unchanged.
   */
  static readonly empty: Layer.Layer<Shelf> = Layer.effect(Shelf)(
    Effect.sync(() =>
      Shelf.of({
        offer: () => Effect.succeed(IndexState.cases.Absent.make({})),
        artifact: Effect.succeed(Option.none()),
        state: Effect.succeed(IndexState.cases.Absent.make({})),
        discard: Effect.void
      })
    )
  )

  /**
   * The default: hold nothing.
   *
   * A default that carried a canonicalizer version would be a default that can
   * silently MATCH one — and a match on a version nobody chose is precisely the
   * silent false negative this whole design is arranged to prevent. So the
   * default declines, and a client that wants an index must say which rules it
   * runs.
   */
  static readonly layer: Layer.Layer<Shelf> = Shelf.empty
}
