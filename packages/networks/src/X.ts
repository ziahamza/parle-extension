/**
 * X, wired but compiled out.
 *
 * ADR 0001 requires "a build flag that compiles X session search out entirely
 * … so a rejected store can still receive a shippable binary rather than
 * blocking the whole release." That flag is `__PARLE_X__`, and it defaults OFF
 * here while the auth research settles. Off, this connector issues no request
 * and emits no `Asking` — it emits a single `Withholding("compiled-out")`,
 * because a Lookup we deliberately did not make is restraint the reader is owed
 * a reason for, not a failure and not an absence.
 *
 * The flag is a bare `declare const` rather than configuration on purpose: a
 * bundler `define` folds `compiledIn()` to a literal, the `XSession` branch
 * becomes unreachable, and the request code is dropped from the artifact. A
 * flag read from a service could not do that, and "compiled out" would be a
 * promise the build could not keep.
 *
 * On, this connector still does not know how to ask X. That is deliberate.
 * X publishes no free URL-search API, so the request has to ride the reader's
 * own session against undocumented endpoints that change without notice — and
 * because it is the READER'S account that gets rate-limited or actioned, the
 * shape of that request is not something to guess at inside a connector. It is
 * an injected `XSession`, absent by default, so the endpoint research lands in
 * one place and this file stays testable without it. With the flag on and no
 * session, the honest answer is a Refusal of `not-signed-in`.
 *
 * What is NOT here: the gate. "X is asked only after another Network returned a
 * Linked Mention" is a decision about accumulated Coverage, which a connector
 * cannot see — it lives in `Gate.mayAskX` in `@parle/domain` and is enforced by
 * `LookupPolicy`. Putting it here would make it a rule each connector could
 * forget; leaving it out is what makes the separate service key worth having,
 * since `X` is only ever reachable through a branch that already holds the
 * evidence.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { type Consultation, type Place } from "@parle/domain/Coverage"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import type { Alias, SubjectUrl } from "@parle/domain/Subject"
import { matchingAddress } from "./Address.ts"
import { Observation, ObservationSink, observeNow } from "./Observation.ts"
import {
  answeredWith,
  asking,
  Declined,
  type DiscussionSourceShape,
  type Unanswered,
  placeOf,
  placesOf,
  withheld
} from "./Source.ts"

/**
 * Build-time switch. Replace with a literal via the bundler's `define`.
 *
 * Undefined in a plain `tsc` build and in tests, which is why the read is
 * guarded rather than direct.
 */
declare const __PARLE_X__: boolean | undefined

const compiledIn = (): boolean => typeof __PARLE_X__ === "boolean" ? __PARLE_X__ : false

/** One post on X, reduced to what a Mention and an Observation need. */
export interface XPost {
  readonly nativeId: string
  /** The address the post linked to, where the session could tell us. */
  readonly submitted: string | null
  readonly score: number | null
  readonly replies: number | null
}

/**
 * How X is actually asked.
 *
 * Absent by default. Anything implementing this is issuing authenticated
 * requests against the reader's own account, so it is a deliberate, separately
 * reviewable thing to provide — not a default anyone can inherit.
 */
export interface XSessionShape {
  readonly linked: (
    subject: SubjectUrl,
    aliases: ReadonlyArray<Alias>
  ) => Effect.Effect<ReadonlyArray<XPost>, Unanswered>
  readonly topical: (
    subject: SubjectUrl,
    title: string
  ) => Effect.Effect<ReadonlyArray<XPost>, Unanswered>
}

export const XSession = Context.Reference<XSessionShape | null>("parle/source/XSession", {
  defaultValue: () => null
})

/**
 * Runtime override for the build flag, for the kill switch and for tests.
 *
 * Its default is the compiled-in value, so leaving it alone never turns X on:
 * a remote manifest can only ever take X away, never grant it to a build that
 * was shipped without the code.
 */
export const XEnabled = Context.Reference<boolean>("parle/source/XEnabled", {
  defaultValue: compiledIn
})

const discussionOf = (post: XPost): DiscussionId =>
  DiscussionId.make({ network: "x", nativeId: NativeId.make(post.nativeId) })

const candidateAddresses = (
  subject: SubjectUrl,
  aliases: ReadonlyArray<Alias>
): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const address of [subject as string, ...aliases.map((alias) => alias.url)]) {
    if (seen.has(address)) continue
    seen.add(address)
    out.push(address)
  }
  return out
}

export class X extends Context.Service<X, DiscussionSourceShape>()("parle/source/X") {
  static readonly layer = Layer.effect(
    X,
    Effect.gen(function*() {
      const record = Effect.fn("X.record")(function*(posts: ReadonlyArray<XPost>) {
        const sink = yield* ObservationSink
        const observations: Array<Observation> = []
        for (const post of posts) {
          observations.push(
            yield* observeNow(discussionOf(post), { score: post.score, comments: post.replies })
          )
        }
        yield* sink.observe(observations)
      })

      const session = Effect.fn("X.session")(function*(): Effect.fn.Return<
        XSessionShape,
        Unanswered
      > {
        const held = yield* XSession
        if (held === null) {
          return yield* Effect.fail(new Declined({ reason: "not-signed-in" }))
        }
        return held
      })

      const linkedAnswer = Effect.fn("X.linkedAnswer")(function*(
        place: Place,
        subject: SubjectUrl,
        aliases: ReadonlyArray<Alias>
      ): Effect.fn.Return<Consultation, Unanswered> {
        const open = yield* session()
        const posts = yield* open.linked(subject, aliases)
        const candidates = candidateAddresses(subject, aliases)

        const kept = new Map<string, { post: XPost; viaAlias: string }>()
        for (const post of posts) {
          if (kept.has(post.nativeId) || post.submitted === null) continue
          const viaAlias = matchingAddress(post.submitted, candidates)
          if (viaAlias === undefined) continue
          kept.set(post.nativeId, { post, viaAlias })
        }

        const linked = [...kept.values()]
        yield* record(linked.map(({ post }) => post))

        return answeredWith(
          place,
          linked.map(({ post, viaAlias }) =>
            Mention.cases.Linked.make({
              subject,
              discussion: discussionOf(post),
              viaAlias
            })
          )
        )
      })

      const topicalAnswer = Effect.fn("X.topicalAnswer")(function*(
        place: Place,
        subject: SubjectUrl,
        title: string
      ): Effect.fn.Return<Consultation, Unanswered> {
        const open = yield* session()
        const posts = yield* open.topical(subject, title)

        const kept = new Map<string, XPost>()
        for (const post of posts) {
          if (!kept.has(post.nativeId)) kept.set(post.nativeId, post)
        }

        const topical = [...kept.values()]
        yield* record(topical)

        return answeredWith(
          place,
          topical.map((post) =>
            Mention.cases.Topical.make({
              subject,
              discussion: discussionOf(post),
              matchedTitle: title
            })
          )
        )
      })

      const linkedPlace = placeOf("x", "linked")
      const topicalPlace = placeOf("x", "topical")

      return X.of({
        network: "x",
        places: placesOf("x"),
        linked: (subject, aliases) =>
          Stream.unwrap(
            Effect.map(XEnabled, (enabled) =>
              enabled
                ? asking(linkedPlace, linkedAnswer(linkedPlace, subject, aliases))
                : withheld(linkedPlace, "compiled-out"))
          ),
        topical: (subject, title) =>
          Stream.unwrap(
            Effect.map(XEnabled, (enabled) =>
              enabled
                ? asking(topicalPlace, topicalAnswer(topicalPlace, subject, title))
                : withheld(topicalPlace, "compiled-out"))
          )
      })
    })
  )
}
