/**
 * The Exclusion List: four layers, of which exactly one is a list.
 *
 * Framing it as one list is the mistake this service exists to prevent. Only
 * layer 2 is enumerated, and it is the only layer that can be missing an entry
 * — which is precisely why the categories it covers worst (internal tools,
 * document IDs, share tokens) are handled by the other three, which are rules.
 *
 * Precedence, highest first, from ticket 03 §5:
 *
 *   1. the reader's allow-anyway   — beats everything below, including the
 *                                    mechanical layer, for `http(s)` hosts
 *   2. the reader's own exclusions
 *   3. mechanical rules            — complete by construction
 *   4. the bundled domain artifact — incomplete, additively updatable
 *   5. URL shape                   — what the address is carrying
 *   6. `noindex`                   — what the page said about itself
 *
 * The reader wins at both ends of that order, which is the design commitment:
 * a built-in layer can be wrong in either direction, and only the reader can
 * tell us which.
 *
 * `excludes` returns the RULE that fired, not a boolean, because the reader is
 * owed an answer to "why was this page excluded" and because the panel's
 * "excluded — check anyway?" affordance is the whole answer to ADR 0005's own
 * objection: a silent false negative is one nobody can complain about.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Exclusion, forbidsIndexing, type PageSignals } from "./Exclusion.ts"
import { mechanical } from "./Mechanical.ts"
import { covers, ReaderChoices } from "./ReaderChoices.ts"
import { type DomainArtifact, type ListedEntry, provenanceOf, seed, withUpdate } from "./Seed.ts"
import { urlShape } from "./UrlShape.ts"

/**
 * Find the longest listed suffix of a host.
 *
 * Suffix matching rather than exact matching is what makes one entry cover a
 * whole estate: `sharepoint.com` reaches every tenant, `barclays.co.uk` reaches
 * every regional host. It stops one label short of the end so that a
 * single-label entry could never match everything under a TLD.
 */
const listedFor = (
  host: string,
  byDomain: ReadonlyMap<string, ListedEntry>
): ListedEntry | undefined => {
  const labels = host.split(".")
  for (let i = 0; i < labels.length - 1; i++) {
    const found = byDomain.get(labels.slice(i).join("."))
    if (found !== undefined) return found
  }
  return undefined
}

const hostOf = (raw: string): string | undefined => {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

const isWebScheme = (raw: string): boolean => {
  try {
    const scheme = new URL(raw).protocol.toLowerCase()
    return scheme === "http:" || scheme === "https:"
  } catch {
    return false
  }
}

export class ExclusionList extends Context.Service<ExclusionList, {
  /** Which artifact version is in force, for the settings page and for support. */
  readonly artifactVersion: number
  /**
   * The rule that excludes this address, or `None`.
   *
   * Takes the address that would actually be SENT — the canonical one — because
   * the fragment and the tracking parameters are already gone by then, and
   * running the shape rules before that both misses secrets that live only in
   * the fragment and fires on ordinary share links.
   */
  readonly excludes: (url: string, signals: PageSignals) => Effect.Effect<Option.Option<Exclusion>>
}>()("parle/policy/ExclusionList") {
  /**
   * Build the service over a specific artifact.
   *
   * This is the documented loader seam. The bundled seed in `Seed.ts` is a
   * placeholder for an artifact built from separately-licensed sources, which
   * cannot be inlined into this AGPL bundle; the extension decodes that file
   * and passes it here. Passing a published update as well folds it in
   * additively — `withUpdate` will not let an update REMOVE an entry, so an
   * artifact host that is compromised, stale or entirely absent cannot widen
   * what we look up.
   */
  static readonly layerFrom = (artifact: DomainArtifact, update?: DomainArtifact) =>
    Layer.effect(
      ExclusionList,
      Effect.gen(function*() {
        const choices = yield* ReaderChoices
        const inForce = update === undefined ? artifact : withUpdate(artifact, update)
        const provenance = provenanceOf(inForce)
        const byDomain = new Map<string, ListedEntry>(inForce.entries.map((e) => [e.domain, e]))

        const excludes = Effect.fn("ExclusionList.excludes")(
          function*(url: string, signals: PageSignals) {
            const chosen = yield* choices.current

            // 1. Allow-anyway beats every built-in layer — but only for real web
            //    schemes. There is no page behind `chrome://settings` to allow.
            if (isWebScheme(url) && chosen.allowedAnyway.some((p) => covers(p, url))) {
              return Option.none<Exclusion>()
            }

            // 2. The reader's own entries.
            const own = chosen.excluded.find((p) => covers(p, url))
            if (own !== undefined) {
              return Option.some(Exclusion.cases.ReaderEntry.make(own))
            }

            // 3. Mechanical rules.
            const mechanically = mechanical(url)
            if (Option.isSome(mechanically)) return mechanically

            // 4. The bundled artifact.
            const host = hostOf(url)
            if (host !== undefined) {
              const listed = listedFor(host, byDomain)
              if (listed !== undefined) {
                return Option.some(
                  Exclusion.cases.ListedDomain.make({
                    domain: listed.domain,
                    category: listed.category,
                    provenance
                  })
                )
              }
            }

            // 5. What the address is carrying.
            const shape = urlShape(url)
            if (Option.isSome(shape)) return shape

            // 6. What the page said about itself. Additive and hard: it is the
            //    only signal that reaches `docs.google.com/document/d/…`.
            if (forbidsIndexing(signals)) return Option.some(Exclusion.cases.NotIndexed.make({}))

            return Option.none<Exclusion>()
          }
        )

        return ExclusionList.of({ artifactVersion: inForce.version, excludes })
      })
    )

  /** The list that ships in the binary, before any artifact has been loaded. */
  static readonly layer = ExclusionList.layerFrom(seed)
}
