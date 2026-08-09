/**
 * The Discussion Index, as the rest of the client sees it.
 *
 * Two members, and the shape of them is the argument:
 *
 * ```ts
 *   hint:  (subject: SubjectUrl) => Effect<Hint>     // Possible | NotListed | NoIndex
 *   state: Effect<IndexState>
 * ```
 *
 * **No method returns a decision, and no method returns a boolean.** There is
 * no `shouldLookUp`, no `has`, no `contains`. ADR 0005 is emphatic that the
 * index does not gate a Lookup until it is exhaustive across every Network we
 * support, because a gate that is wrong produces a silent false negative — a
 * Lookup that never fires, a Discussion the reader never learns existed, and no
 * signal that anything was withheld. Promoting the index to a gate later means
 * adding a constructor to `Hint`, which breaks every match site in the
 * codebase. That friction is the mechanism, not an accident of design.
 *
 * **It is reached only through `Effect.serviceOption`.** Whoever consults the
 * index does so optionally, so its identifier never enters their requirement
 * channel and the client provably builds without it. That is ADR 0011 — the
 * client is autonomous, the backend is an accelerator — as a compile-time fact
 * rather than a convention someone has to remember.
 *
 * What the index is actually *for*, given it cannot gate:
 *
 * - **Ordering.** `Possible`, with the Networks that suspect it, says where to
 *   look first.
 * - **Distrusting a zero.** ADR 0005 forbids the index from suppressing a
 *   Lookup; nothing forbids it from making us doubt one. A Network answering
 *   with a Silence on a Subject the index suspects is a *suspect* Silence: do
 *   not cache it, do not close the X gate on it, ask again. That is a free
 *   instrument and it adds no gate.
 */
import type { SubjectUrl } from "@parle/domain/Subject"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { hintFor, type Artifact } from "./Artifact.ts"
import { Hint, noIndex } from "./Hint.ts"
import { IndexState } from "./IndexState.ts"
import { Shelf } from "./Shelf.ts"

export class DiscussionIndex extends Context.Service<DiscussionIndex, {
  /**
   * What the index has to say about a Subject.
   *
   * Never fails. An index that could fail would put its own availability into
   * the caller's error channel, and the caller would then have to decide what
   * an unavailable index means — which is the decision this type exists to
   * take away from them.
   */
  readonly hint: (subject: SubjectUrl) => Effect.Effect<Hint>
  /**
   * What the client is holding.
   *
   * Separate from `hint` because "the index is stale" and "the index is absent"
   * are different states needing different copy, and neither of them is an
   * answer about a Subject.
   */
  readonly state: Effect.Effect<IndexState>
}>()("parle/backend/DiscussionIndex") {
  /** Read through whatever the {@link Shelf} currently holds. */
  static readonly layer: Layer.Layer<DiscussionIndex, never, Shelf> = Layer.effect(DiscussionIndex)(
    Effect.gen(function*() {
      const shelf = yield* Shelf

      const hint = Effect.fn("DiscussionIndex.hint")(function*(subject: SubjectUrl) {
        const artifact = yield* shelf.artifact
        return Option.match(artifact, {
          onNone: () => noIndex,
          onSome: (held: Artifact) => hintFor(held, subject)
        })
      })

      return DiscussionIndex.of({ hint, state: shelf.state })
    })
  )

  /**
   * An index that holds nothing and says so.
   *
   * The state a fresh install, an offline reader, a build with no index origin
   * and a self-hoster who has not published yet are all in — which is to say,
   * a normal one. Every caller must already handle it, so it is worth having a
   * one-line way to test that they do.
   */
  static readonly absent: Layer.Layer<DiscussionIndex> = Layer.effect(DiscussionIndex)(
    Effect.sync(() =>
      DiscussionIndex.of({
        hint: () => Effect.succeed(noIndex),
        state: Effect.succeed(IndexState.cases.Absent.make({}))
      })
    )
  )

  /** The whole client-side stack, over a shelf for a given canonicalizer version. */
  static readonly layerFor = (clientCanonicalizerVersion: string): Layer.Layer<DiscussionIndex> =>
    DiscussionIndex.layer.pipe(Layer.provide(Shelf.layerFor(clientCanonicalizerVersion)))
}
