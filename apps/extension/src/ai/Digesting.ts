/**
 * Writing a Digest for one Subject, and turning every way that can fail into a
 * state with its own words.
 *
 * This is the whole of the extension's side of `@parle/digest`. Three things
 * about it are decisions rather than plumbing.
 *
 * **The Provider layer is built here, per request, from the settings document.**
 * See `./Connected.ts` for why it cannot be built once at worker start. What
 * matters at this seam is that `Digests.digest` requires `Provider` and never
 * learns which one it got.
 *
 * **`admit` is the only door in, and it is `@parle/digest`'s to hold.** Nothing
 * in this file constructs a Finding; it runs `Digests.digest`, which decodes
 * every candidate against the Brief and re-admits the assembled document. What
 * crosses to the panel afterwards is `Attributed` — a plain shape that carries
 * no claim about what it was written from, because the panel cannot re-check
 * the invariant and must not appear to.
 *
 * **Every failure gets its own sentence, and the sentence is written here.**
 * ADR 0011 makes a degraded capability a state the panel renders rather than an
 * error it throws, and a state with generic words is the same absence wearing a
 * different coat. "Your key was rejected", "your account is out of credit" and
 * "the model answered with nothing we could point at" want different copy and
 * different offers, and this is the only place that knows which happened.
 *
 * A Provider that dies mid-answer is deliberately NOT in the failure list. It
 * yields a `partial` Digest of the Findings that did arrive — `@parle/digest`
 * streams Findings precisely so that a model cut off after two good ones does
 * not cost the reader those two, out of their own subscription.
 *
 * **What this does not do yet, on purpose: render Findings as they arrive.**
 * `Digests.write` is a `Stream<Finding>` and `Digests.digest` collects it; this
 * calls the second. The seam for the first is intact and unused — a panel could
 * subscribe to `write` and draw each Finding the moment it lands, which is what
 * ADR 0008's conversational panel eventually wants. It is not wired because
 * `Knowledge` publishes whole values and `Written` carries a completeness that
 * is only knowable once the Provider has stopped; streaming would mean either a
 * fifth Digest state or a Written whose `completeness` changes under the reader.
 * That is a real design decision to take deliberately, not a line to add here,
 * and until it is taken the panel says `Writing…` and then shows the answer.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import type { LinkedMention } from "@parle/domain/Mention"
import type { SubjectUrl } from "@parle/domain/Subject"
import { discussionKey } from "@parle/domain/Network"
import * as Brief from "@parle/digest/Brief"
import { Comments } from "@parle/digest/Comments"
import { type DigestRefused, Digests } from "@parle/digest/Digests"
import { defaultLimits } from "@parle/digest/Selection"
import type { UnavailableReason } from "@parle/provider/Provider"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { DigestStanding, type Attributed, type DigestOffer } from "../enquiry/Knowledge.ts"
import { Settings } from "../settings/Settings.ts"
import { connectionOf, isConnected, PROVIDER_NAMES, providerFor } from "./Connected.ts"

/**
 * How many Discussions a Digest is written from.
 *
 * `@parle/digest`'s own default, named here because it is also the number the
 * panel shows the reader before they agree to it. Two constants would be one
 * promise and one behaviour.
 */
export const DISCUSSIONS_READ = defaultLimits.discussions

/** What a Provider's own reason means for the reader, and what to offer them. */
const providerWords = (
  reason: UnavailableReason,
  provider: string
) => {
  switch (reason) {
    case "not-connected":
      return {
        because: "no Provider is connected.",
        offer: "connect"
      }
    case "not-authorized":
      return {
        because: `${provider} rejected the key Parle sent — revoked, or pasted wrong.`,
        offer: "connect"
      }
    case "over-quota":
      return {
        because: `${provider} says the account cannot pay for this.`,
        offer: "connect"
      }
    case "rate-limited":
      return {
        because: `${provider} asked us to slow down. Worth trying again shortly.`,
        offer: "again"
      }
    case "could-not-answer":
      return {
        because: `${provider} took the request, then said it had failed.`,
        offer: "again"
      }
    case "unreachable":
      return {
        because: `Parle could not reach ${provider}.`,
        offer: "again"
      }
    case "garbled":
      return {
        because: `${provider} answered, and the answer was unreadable.`,
        offer: "again"
      }
    case "no-model":
      return {
        because: "This browser has no built-in model.",
        offer: "connect"
      }
  }
}

/** What a refusal from `@parle/digest` means for the reader. */
const refusalWords = (
  refused: DigestRefused,
  provider: string
) => {
  switch (refused.reason) {
    case "nothing-to-summarise":
      return {
        because:
          "Parle could not read the comments of any of these discussions. " +
          `Nothing was sent to ${provider}.`,
        offer: "again"
      }
    case "provider-unavailable":
      return providerWords(refused.providerReason ?? "could-not-answer", provider)
    case "nothing-citeable":
      return {
        because:
          `${provider} answered, but nothing it wrote pointed at a comment Parle had read.`,
        offer: "again"
      }
  }
}

/**
 * What the reader is told a Digest would cost before they ask for one.
 *
 * Counted from the Linked Mentions rather than stated as a maximum, because
 * "up to six discussions" on a page with one is a warning about something that
 * is not going to happen, and a disclosure that overstates is one the reader
 * learns to skip.
 */
export const wouldRead = (linked: ReadonlyArray<LinkedMention>): number => {
  const seen = new Set<string>()
  for (const mention of linked) seen.add(discussionKey(mention.discussion))
  return Math.min(seen.size, DISCUSSIONS_READ)
}

export class Digesting extends Context.Service<Digesting, {
  /**
   * Read the comments, ask the Provider, and hold the answer to the Brief.
   *
   * Total. Every failure comes back as a state with its own words, which is
   * ADR 0011's requirement and the reason the caller can fold this straight
   * into Knowledge without an error channel.
   */
  readonly write: (
    subject: SubjectUrl,
    linked: ReadonlyArray<LinkedMention>
  ) => Effect.Effect<DigestStanding>
}>()("parle/extension/ai/Digesting") {
  static readonly layer: Layer.Layer<
    Digesting,
    never,
    Settings | Comments | Digests | HttpClient.HttpClient
  > = Layer.effect(
    Digesting,
    Effect.gen(function*() {
      const settings = yield* Settings
      const comments = yield* Comments
      const digests = yield* Digests
      const http = yield* Effect.context<HttpClient.HttpClient>()

      const write = Effect.fn("Digesting.write")(function*(
        subject: SubjectUrl,
        linked: ReadonlyArray<LinkedMention>
      ) {
        const held = yield* settings.current
        const provider = PROVIDER_NAMES[connectionOf(held)]
        // The reader asked from a panel that was drawn before they disconnected,
        // or never connected at all. Reported as the Provider's own
        // `not-connected` rather than short-circuited, so there is exactly one
        // place that turns a reason into words.
        if (!isConnected(held)) {
          return DigestStanding.cases.Refused.make(providerWords("not-connected", provider))
        }

        // Reading the comments is the expensive half and it happens first, so a
        // Brief that turns out to be empty costs the reader nothing from their
        // own Provider quota.
        const material = yield* digests.brief(subject, linked).pipe(
          Effect.provideService(Comments, comments)
        )

        const written = yield* digests.digest(material).pipe(
          Effect.provide(Brief.layerOf(material)),
          Effect.provide(providerFor(held)),
          Effect.provide(http),
          Effect.result
        )

        if (Result.isFailure(written)) {
          return DigestStanding.cases.Refused.make(refusalWords(written.failure, provider))
        }

        return DigestStanding.cases.Written.make({
          origin: written.success.origin,
          completeness: written.success.completeness,
          findings: written.success.findings.map((finding): Attributed => ({
            statement: finding.statement,
            contested: finding.contested,
            citations: finding.citations
          }))
        })
      })

      return Digesting.of({ write })
    })
  )
}
