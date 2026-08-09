/**
 * What the reader has decided, which beats every built-in layer in both
 * directions.
 *
 * This is the cheapest genuine improvement available in the whole Exclusion
 * List design, because it converts residual risk from "we failed to anticipate
 * your bank" into "you told us once" — and every shipping analogue of this
 * product converged on exactly these four controls.
 *
 * The reason they live behind a service rather than in a module-level object is
 * that MV3 kills the worker without running finalizers, so these must be read
 * from durable storage on every decision rather than captured once at layer
 * build. The methods are therefore `Effect`s, not values: {@link inMemory} is a
 * test double and a first-run default, and the extension substitutes a layer
 * over the same key backed by the reader's own store.
 *
 * Precedence, highest first, and the whole point of the ordering is that the
 * reader wins twice: allow-anyway beats every built-in layer including the
 * mechanical one (for `http(s)` hosts), and their own exclusions beat the
 * bundled artifact.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"

/**
 * A host, or a host and a path prefix under it.
 *
 * Path prefixes exist because the interesting cases are not whole sites:
 * `docs.google.com` matters and `google.com` must not, `example.com/admin`
 * matters and `example.com/blog` must not.
 */
export interface SitePattern {
  readonly host: string
  /** The empty string matches every path on the host. */
  readonly pathPrefix: string
}

/** A pattern covering a whole host and all of its subdomains. */
export const wholeSite = (host: string): SitePattern => ({ host: host.toLowerCase(), pathPrefix: "" })

/**
 * True when a pattern covers an address.
 *
 * Host matching includes subdomains, so a reader who excludes `example.com`
 * also excludes `app.example.com` — which is what they meant, and the direction
 * in which being wrong is safe.
 */
export const covers = (pattern: SitePattern, raw: string): boolean => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  const target = pattern.host.toLowerCase()
  const hostMatches = host === target || host.endsWith(`.${target}`)
  return hostMatches && url.pathname.startsWith(pattern.pathPrefix)
}

/** Everything the reader has said about where we may ask. */
export interface Choices {
  readonly excluded: ReadonlyArray<SitePattern>
  readonly allowedAnyway: ReadonlyArray<SitePattern>
  /** Hosts paused for now — a softer, reversible thing than an exclusion. */
  readonly paused: ReadonlyArray<string>
  /** No automatic Lookup anywhere. The toolbar still works everywhere. */
  readonly manualOnly: boolean
}

export const noChoices: Choices = { excluded: [], allowedAnyway: [], paused: [], manualOnly: false }

export class ReaderChoices extends Context.Service<ReaderChoices, {
  /** Read fresh on every decision — the worker may have died since the last one. */
  readonly current: Effect.Effect<Choices>
  readonly pauseSite: (host: string) => Effect.Effect<void>
  readonly resumeSite: (host: string) => Effect.Effect<void>
  readonly exclude: (pattern: SitePattern) => Effect.Effect<void>
  readonly allowAnyway: (pattern: SitePattern) => Effect.Effect<void>
}>()("parle/policy/ReaderChoices") {
  /**
   * A layer holding the reader's choices in memory.
   *
   * Correct for tests and for a first run, and deliberately NOT correct for the
   * extension: a pause that a service-worker restart forgets is a pause the
   * reader has to keep making.
   */
  static readonly inMemory = (initial: Choices = noChoices) =>
    Layer.effect(
      ReaderChoices,
      Effect.gen(function*() {
        const cell = yield* Ref.make(initial)

        const pauseSite = Effect.fn("ReaderChoices.pauseSite")(function*(host: string) {
          const lower = host.toLowerCase()
          yield* Ref.update(cell, (c) =>
            c.paused.includes(lower) ? c : { ...c, paused: [...c.paused, lower] })
        })

        const resumeSite = Effect.fn("ReaderChoices.resumeSite")(function*(host: string) {
          const lower = host.toLowerCase()
          yield* Ref.update(cell, (c) => ({ ...c, paused: c.paused.filter((h) => h !== lower) }))
        })

        const exclude = Effect.fn("ReaderChoices.exclude")(function*(pattern: SitePattern) {
          yield* Ref.update(cell, (c) => ({ ...c, excluded: [...c.excluded, pattern] }))
        })

        const allowAnyway = Effect.fn("ReaderChoices.allowAnyway")(function*(pattern: SitePattern) {
          yield* Ref.update(cell, (c) => ({ ...c, allowedAnyway: [...c.allowedAnyway, pattern] }))
        })

        return ReaderChoices.of({ current: Ref.get(cell), pauseSite, resumeSite, exclude, allowAnyway })
      })
    )

  /** The default: the reader has said nothing yet. */
  static readonly layer = ReaderChoices.inMemory()
}
