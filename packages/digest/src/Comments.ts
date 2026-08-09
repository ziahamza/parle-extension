/**
 * Where the comments in a Brief come from.
 *
 * Nothing in the repo reads comment bodies yet — the connectors in
 * `@parle/networks` read what a Mention and an Observation need and deliberately
 * stop there — so this is the seam that says what a Brief requires without
 * deciding how it is met. An Algolia `search_by_date` over an item's children, a
 * Reddit `.json` on a permalink, and a recorded fixture in a test are all the
 * same shape to `brief`.
 *
 * The method is TOTAL. A Discussion whose comments cannot be read contributes
 * nothing to the Brief and that is the whole consequence: `brief` keeps its
 * `Effect<Brief, never, …>` signature, and a Reddit 403 — ADR 0013's ordinary
 * path, not an edge case — costs the reader the one Discussion rather than the
 * Digest. Anything worth telling the reader about a Lookup that did not answer
 * belongs in Coverage, which is a different mechanism with a different
 * vocabulary and is not this.
 */
import type { DiscussionId } from "@parle/domain/Network"
import { discussionKey } from "@parle/domain/Network"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type { Contents } from "./Brief.ts"

export class Comments extends Context.Service<Comments, {
  /** What one Discussion says, or nothing if we could not read it. Never fails. */
  readonly of: (discussion: DiscussionId) => Effect.Effect<Option.Option<Contents>>
}>()("parle/digest/Comments") {
  /**
   * A Comments that can read nothing.
   *
   * Not a null object for tests: it is what a build with no comment connector
   * wires, and it makes the consequence explicit — every Brief comes back empty,
   * `write` refuses with `nothing-to-summarise`, and no Provider request is
   * made. The alternative, a Brief of titles with no comments, would ask a model
   * to summarise a conversation it was never shown.
   */
  static readonly layerEmpty: Layer.Layer<Comments> = Layer.succeed(
    Comments,
    Comments.of({ of: () => Effect.succeed(Option.none<Contents>()) })
  )

  /** Comments already in hand, keyed by (Network, native id). For tests and fixtures. */
  static readonly layerOf = (
    held: ReadonlyMap<string, Contents>
  ): Layer.Layer<Comments> =>
    Layer.succeed(
      Comments,
      Comments.of({
        of: (discussion) =>
          Effect.succeed(Option.fromUndefinedOr(held.get(discussionKey(discussion))))
      })
    )
}
