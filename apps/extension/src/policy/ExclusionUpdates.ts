/**
 * The published exclusion artifact: fetched on a slow clock, held on disk,
 * folded into the bundled seed at the next worker start.
 *
 * This is stage one of ADR 0022 — the smallest piece of the backend track. A
 * miss in the bundled skip list (an AI-chat service nobody had listed, a bank
 * the sources missed) currently waits for a store release to fix; this file
 * makes it a data push instead. What keeps that safe is entirely on the
 * client: `Seed.withUpdate` folds additively and version-gated, so the host
 * can only ever ADD exclusions — narrow what is looked up — never widen it,
 * and `ExclusionFeed.readArtifact` treats the body as untrusted text.
 *
 * What this sends: one GET for a file that is byte-identical for every
 * install, at most once a day, carrying no cookies and nothing about the
 * reader or any page they visited. It still does not run before the reader
 * has answered the first-run question — "nothing at all is sent until you
 * answer" is a claim about requests, not merely about addresses, and this
 * module honours the strong reading.
 *
 * An update takes effect at the next service-worker start rather than
 * mid-flight: MV3 restarts the worker within minutes of ordinary browsing,
 * and rebinding a live layer for a list that changes monthly buys nothing.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { Storage as Kept } from "@parle/memory/Storage"
import { readArtifact } from "@parle/policy/ExclusionFeed"
import type { DomainArtifact } from "@parle/policy/Seed"
import { Settings } from "../settings/Settings.ts"

/**
 * Published from the repository itself: versioned by git, reviewable by
 * anyone, and additive by client-side construction. ADR 0022 records why the
 * host may move (Cloudflare, with the Discussion Index) without this module
 * changing shape — the URL is the only fact about it.
 */
export const FEED_URL = "https://raw.githubusercontent.com/ziahamza/parle-extension/main/artifacts/exclusions.json"

/** Where the held copy lives. Cleared with everything else by a full forget. */
export const HELD_KEY = "parle/exclusions/update"

/** A day. The list changes on the timescale of store releases, not of pages. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000

interface Held {
  readonly fetchedAt: number
  readonly artifact: DomainArtifact
}

const readHeld = (text: string): Option.Option<Held> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return Option.none()
  }
  if (typeof parsed !== "object" || parsed === null) return Option.none()
  const held = parsed as { readonly fetchedAt?: unknown; readonly artifact?: unknown }
  if (typeof held.fetchedAt !== "number") return Option.none()
  const artifact = readArtifact(JSON.stringify(held.artifact))
  return Option.isNone(artifact) ? Option.none() : Option.some({ fetchedAt: held.fetchedAt, artifact: artifact.value })
}

export class ExclusionUpdates extends Context.Service<ExclusionUpdates, {
  /**
   * The artifact held on disk, if any. Read once, at layer build — the value
   * every decision this worker makes is built over.
   */
  readonly held: Effect.Effect<DomainArtifact | undefined>
  /**
   * Fetch a newer artifact if the held one is stale, and hold it for the next
   * worker. Total: a refused fetch, a garbage body and an unwritable store all
   * degrade to the artifact already held — the bundled seed at worst.
   */
  readonly freshen: Effect.Effect<void>
}>()("parle/app/ExclusionUpdates") {
  static readonly layer: Layer.Layer<
    ExclusionUpdates,
    never,
    Kept | HttpClient.HttpClient | Settings
  > = Layer.effect(
    ExclusionUpdates,
    Effect.gen(function*() {
      const storage = yield* Kept
      const client = yield* HttpClient.HttpClient
      const settings = yield* Settings

      const held = Effect.gen(function*() {
        const text = yield* storage.get(HELD_KEY).pipe(
          Effect.catchCause(() => Effect.succeed(Option.none<string>()))
        )
        if (Option.isNone(text)) return undefined
        const read = readHeld(text.value)
        return Option.isNone(read) ? undefined : read.value.artifact
      })

      const freshen = Effect.gen(function*() {
        // Not before the reader has answered the first-run question: until
        // then, no request of any kind leaves this extension.
        const chosen = yield* settings.current
        if (!chosen.decided) return
        const text = yield* storage.get(HELD_KEY).pipe(
          Effect.catchCause(() => Effect.succeed(Option.none<string>()))
        )
        if (Option.isSome(text)) {
          const read = readHeld(text.value)
          if (Option.isSome(read) && Date.now() - read.value.fetchedAt < STALE_AFTER_MS) return
        }
        const response = yield* client.get(FEED_URL)
        if (response.status < 200 || response.status >= 300) return
        const body = yield* response.text
        const artifact = readArtifact(body)
        if (Option.isNone(artifact)) return
        yield* storage.set(
          HELD_KEY,
          JSON.stringify({ fetchedAt: Date.now(), artifact: artifact.value })
        ).pipe(Effect.catchCause(() => Effect.void))
      }).pipe(Effect.catchCause(() => Effect.void))

      return ExclusionUpdates.of({ held, freshen })
    })
  )
}
