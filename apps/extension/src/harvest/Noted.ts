/**
 * Where a harvested Discussion's title goes.
 *
 * `@parle/harvest`'s `DiscussionSink` exists because the Local Discussion Cache
 * holds Mentions and Observations and has nowhere to put a title — and a
 * connector that reads a title off a page and drops it makes it unrecoverable
 * without asking the Network again. That sink says the integrator decides where
 * it lands. This is the integrator deciding.
 *
 * It lands **on disk, beside the Mentions**, and it has to: a Mention with no
 * title is a row `panelOf` skips, so a Local Discussion Cache that survived a
 * worker restart while its titles did not would be a cache that fills up and
 * never renders anything. The instant click-through case ADR 0012 exists for is
 * precisely the case where the worker has been killed and restarted since the
 * page was harvested.
 *
 * **This is still pointers, not content.** A title, the address the Discussion
 * submitted, when it started and who posted it are what a row is drawn from, and
 * all four were on the page the reader was already looking at. Comment bodies —
 * the thing a Digest is written from, and the only material here that is
 * genuinely expensive — are fetched live when the reader asks, exactly as ADR
 * 0012 says.
 *
 * It shares {@link CACHE_ROOT} with `Recollection` so that both clearing
 * controls reach it: a store under a root of its own would be cleared by
 * neither control and mentioned by no disclosure.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { DiscussionId, discussionKey } from "@parle/domain/Network"
import { readText, writeText } from "@parle/memory/Codec"
import { substitute, swallow } from "@parle/memory/Storage"
import { CACHE_ROOT, LocalCache } from "./LocalCache.ts"

/**
 * A Discussion as harvested, stored.
 *
 * Its own schema rather than `@parle/harvest`'s or `@parle/networks`' opaque
 * class, because this is a *storage format*: it outlives the build that wrote
 * it, so it has to be a shape this file can keep answering for. The two package
 * types are converted at the edges, which is also what stops a Reddit row and a
 * Hacker News row being told apart by anything other than `discussionKey`.
 */
const Noted_ = Schema.Struct({
  id: DiscussionId,
  title: Schema.String,
  submittedUrl: Schema.NullOr(Schema.String),
  postedAt: Schema.NullOr(Schema.Number),
  author: Schema.NullOr(Schema.String)
})
type Noted_ = typeof Noted_.Type

/** What a harvest saw, in the shape both packages' Discussion types share. */
export interface Seen {
  readonly id: DiscussionId
  readonly title: string
  readonly submittedUrl: string | null
  readonly postedAt: number | null
  readonly author: string | null
}

export class Noted extends Context.Service<Noted, {
  /**
   * Keep what a harvest saw. Total: a title that will not store costs the reader
   * a row, never an Enquiry.
   */
  readonly note: (discussions: ReadonlyArray<Seen>) => Effect.Effect<void>
  /** What is held about these Discussions, and nothing about the ones we have never seen. */
  readonly describe: (
    ids: ReadonlyArray<DiscussionId>
  ) => Effect.Effect<ReadonlyArray<Seen>>
}>()("parle/extension/harvest/Noted") {
  static readonly layer: Layer.Layer<Noted, never, LocalCache> = Layer.effect(
    Noted,
    Effect.gen(function*() {
      const cache = yield* LocalCache
      const store = cache.kept

      const note = Effect.fn("Noted.note")(function*(discussions: ReadonlyArray<Seen>) {
        for (const seen of discussions) {
          // A title does not move, so a later reading is the same reading and
          // overwriting is free. That is the opposite of an Observation's rule,
          // and the split is the reason they are stored apart.
          const text = yield* writeText(Noted_, seen as Noted_, "Noted")
          if (Option.isSome(text)) {
            yield* swallow(store.set(keyOf(seen.id), text.value), "Noted")
          }
        }
      })

      const describe = Effect.fn("Noted.describe")(function*(ids: ReadonlyArray<DiscussionId>) {
        const found: Array<Seen> = []
        const seen = new Set<string>()
        for (const id of ids) {
          const key = discussionKey(id)
          if (seen.has(key)) continue
          seen.add(key)
          const raw = yield* substitute(store.get(keyOf(id)), Option.none<string>(), "Noted")
          if (Option.isNone(raw)) continue
          const held = yield* readText(Noted_, raw.value, "Noted")
          if (Option.isSome(held)) found.push(held.value)
        }
        return found
      })

      return Noted.of({ note, describe })
    })
  )
}

/**
 * Keyed on the (Network, native id) pair, never the bare id — the same rule
 * `Recollection` keeps its Observations under. Reddit's base-36 ids and Hacker
 * News' decimal ids share a namespace by accident, and a bare-string key merges
 * two unrelated conversations into one row.
 */
const keyOf = (id: DiscussionId): string =>
  `${CACHE_ROOT}described/${encodeURIComponent(discussionKey(id))}`
