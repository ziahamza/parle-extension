/**
 * Everything the connectors described, kept where a panel row can be drawn from it.
 *
 * A `Mention` says *this Discussion concerns this Subject, and here is the
 * evidence*. That is exactly what Coverage needs and exactly nothing a row can
 * be drawn from — no title, no score, no age. The connectors read those off the
 * wire and hand them over through `DiscussionSink` and `ObservationSink`, two
 * `Context.Reference`s whose `Identifier` is `never` so a connector keeps the
 * `Stream<Consultation, never, never>` its contract promises. This is the thing
 * on the other side of both.
 *
 * It is keyed on the Discussion, not on the Subject, because that is what the
 * facts are about: one Hacker News thread has one title however many Subjects
 * turn out to mention it, and storing it per-Subject would keep several copies
 * that could disagree.
 *
 * Two write rules, and they are opposite on purpose:
 *
 *   - A **Discussion** is overwritten freely. A title and a submitted address
 *     do not move, so a later reading of them is the same reading.
 *   - An **Observation** is never corrected, only SUPERSEDED, and by OUR
 *     receive time. No Network states when its numbers were true, so a late
 *     answer carrying older numbers must not walk a score backwards — which
 *     would render as a Movement we invented.
 *
 * The store lives in the worker's heap and dies with it. That is deliberate
 * rather than unfinished: what it holds is derived from Lookups, so persisting
 * it would put a durable, plaintext record of the reader's browsing on disk.
 * ADR 0012's Local Discussion Cache is Harvest-filled for exactly that reason,
 * and the lookup-derived record that IS allowed to persist is the Lookup
 * Record, under opaque keys.
 *
 * What DID become durable is the Harvest-filled half, and {@link Recalled} is
 * how it is reached from here. A recalled Mention arrives from the reader's own
 * disk with no Lookup behind it, so nothing ever described its Discussion to
 * this store — and `panelOf` skips a Mention it cannot draw, which would make a
 * cache hit render as an empty panel on any worker that had been restarted since
 * the harvest. That is the exact case ADR 0012 exists for, so it is the exact
 * case that must not be the one this store cannot answer.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { type DiscussionId, discussionKey } from "@parle/domain/Network"
import type { Mention } from "@parle/domain/Mention"
import type { Discussion } from "@parle/networks/Discussion"
import type { Observation } from "@parle/networks/Observation"

/**
 * How many Discussions the worker will describe before forgetting the oldest.
 *
 * MV3 tears the worker down after about thirty seconds of quiet, so in practice
 * this never binds. It exists for the reader who leaves a tab churning for an
 * hour, where "bounded by a worker lifetime" stops being a bound.
 */
const KEEP = 5_000

/** What one set of Mentions can actually be drawn as. */
export interface Rows {
  readonly discussions: ReadonlyArray<Discussion>
  readonly observations: ReadonlyArray<Observation>
}

export const noRows: Rows = { discussions: [], observations: [] }

/**
 * What the reader's own disk can say about a Discussion nothing asked about.
 *
 * A `Context.Reference` and not a `Context.Service`, for the reason the two
 * connector sinks are: its `Identifier` is `never`, so consulting it adds
 * nothing to `Gathered`'s requirement channel and this module keeps its promise
 * of having no runtime dependencies beyond the two row types. The default knows
 * nothing, so a graph that wires no durable cache behaves exactly as it did
 * before there was one.
 */
export interface RecalledShape {
  readonly describe: (ids: ReadonlyArray<DiscussionId>) => Effect.Effect<Rows>
}

const knowsNothing: RecalledShape = { describe: () => Effect.succeed(noRows) }

export const Recalled = Context.Reference<RecalledShape>(
  "parle/extension/gathered/Recalled",
  { defaultValue: () => knowsNothing }
)

export class Gathered extends Context.Service<Gathered, {
  /** Take in what a connector described. Total: losing a row is not a failure. */
  readonly note: (discussions: ReadonlyArray<Discussion>) => Effect.Effect<void>
  readonly observe: (observations: ReadonlyArray<Observation>) => Effect.Effect<void>
  /** Everything known about these Mentions' Discussions, and nothing else. */
  readonly rowsFor: (mentions: ReadonlyArray<Mention>) => Effect.Effect<Rows>
}>()("parle/extension/gathered/Gathered") {
  static readonly layer = Layer.effect(
    Gathered,
    Effect.sync(() => {
      const described = new Map<string, Discussion>()
      const observed = new Map<string, Observation>()

      /** Map preserves insertion order, so the first key is the oldest. */
      const trim = (held: Map<string, unknown>) => {
        while (held.size > KEEP) {
          const oldest = held.keys().next()
          if (oldest.done === true) return
          held.delete(oldest.value)
        }
      }

      const note = Effect.fn("Gathered.note")(function*(discussions: ReadonlyArray<Discussion>) {
        for (const discussion of discussions) {
          described.set(discussionKey(discussion.id), discussion)
        }
        trim(described)
      })

      const observe = Effect.fn("Gathered.observe")(function*(
        observations: ReadonlyArray<Observation>
      ) {
        for (const observation of observations) {
          const key = discussionKey(observation.discussion)
          const standing = observed.get(key)
          if (standing !== undefined && standing.receivedAt > observation.receivedAt) continue
          observed.set(key, observation)
        }
        trim(observed)
      })

      const rowsFor = Effect.fn("Gathered.rowsFor")(function*(mentions: ReadonlyArray<Mention>) {
        const discussions: Array<Discussion> = []
        const observations: Array<Observation> = []
        const seen = new Set<string>()
        /** Mentions no Lookup on this worker described. The reader's disk may have. */
        const unheard: Array<DiscussionId> = []
        for (const mention of mentions) {
          const key = discussionKey(mention.discussion)
          if (seen.has(key)) continue
          seen.add(key)
          const discussion = described.get(key)
          if (discussion !== undefined) discussions.push(discussion)
          else unheard.push(mention.discussion)
          const observation = observed.get(key)
          if (observation !== undefined) observations.push(observation)
        }
        if (unheard.length === 0) return { discussions, observations } satisfies Rows

        // Asked for only what is missing, and asked LAST, so a live answer is
        // never displaced by a harvested one. What a Network said a moment ago
        // is a better reading than what a page showed the reader last week.
        const recalled = yield* Recalled
        const held = yield* recalled.describe(unheard)
        const already = new Set(observations.map((o) => discussionKey(o.discussion)))
        return {
          discussions: [...discussions, ...held.discussions],
          observations: [
            ...observations,
            ...held.observations.filter((o) => !already.has(discussionKey(o.discussion)))
          ]
        } satisfies Rows
      })

      return Gathered.of({ note, observe, rowsFor })
    })
  )
}
