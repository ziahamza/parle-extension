/**
 * The whole dependency graph except the extension surface, as a function of its
 * two seams.
 *
 * It is assembled bottom-up rather than declared as one flat merge so that two
 * things are visible in the shape of the graph rather than asserted in a
 * comment.
 *
 * **X's position.** It is a peer of the other Networks under `Enquiry`, and
 * nothing above `Enquiry` can reach it. ADR 0001's gate is enforced by
 * `LookupPolicy`, but a caller that could get hold of the `X` service directly
 * would be able to route around it, and the cheapest way to make that
 * impossible is never to put it in anyone else's requirement channel.
 *
 * **One Local Discussion Cache, two views of it, and the seam between them is
 * the whole of ADR 0012's privacy argument.** A cache filled by Harvest holds
 * what the reader saw on pages they had already opened, so it discloses nothing
 * extra; a cache filled by **Lookups** is a durable record of everywhere they
 * browsed. Same rows, opposite properties. So `harvest/LocalCache.ts` has
 * exactly one durable store and exactly two views onto it: the read-write one,
 * handed to the `Recollection` that only `@parle/harvest`'s `Harvester` writes
 * through, and the read-through one below, handed to the Enquiry — reads fall
 * through to disk, writes stay in the worker's heap. `Enquiry.publish` calls
 * `remember` on every Lookup answer, and through that view it lands in a `Map`
 * that dies with the worker, exactly as every Mention did before anything was
 * persisted at all.
 *
 * Read the two `Layer.provide` calls below as the enforcement: a Lookup-derived
 * Mention reaching disk would require handing the Enquiry the other view, which
 * is a visible change here rather than a slip inside a function.
 *
 * `@parle/memory`'s `LookupRecord` (opaque keys, "at most once per long TTL")
 * IS wired now — see `lookupRecord` below for exactly how much of it, because
 * the reason it sat unwired has not gone: skipping a Lookup because we asked
 * recently is only safe if something can still answer, and what can answer is
 * the Harvest-filled half — which holds the pages the reader *saw*, not the
 * ones they visited. So the Enquiry gates on the two-minute LEASE alone, never
 * on a settled answer, and a TTL-keyed skip that would empty the panel on an
 * ordinary revisit remains unbuilt. Its `LastLook` is not wired because ADR
 * 0007's 2026-08-08 amendment deleted the horizon it served.
 *
 * The platform and the HTTP client are parameters rather than imports so that
 * the graph as it actually ships can be built in a test — over the platform
 * double and a recorded wire — instead of a hand-assembled lookalike that can
 * drift from it silently. That is the only reason this is a function.
 *
 * Note what is *not* here: no backend, and no Provider. ADR 0011 says the
 * extension is fully functional with the backend absent, and this graph is
 * where that claim is either true or marketing. It builds, and the product
 * works, with neither.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { ReadingWatch } from "@parle/browser/ReadingWatch"
import { asText, Storage } from "@parle/browser/Storage"
import { Tabs } from "@parle/browser/Tabs"
import type { WebExt } from "@parle/browser/WebExtApi"
import { Digests } from "@parle/digest/Digests"
import { Recollection } from "@parle/memory/Recollection"
import { FrontDoorMemory } from "@parle/memory/FrontDoorMemory"
import { LookupRecord } from "@parle/memory/LookupRecord"
import { OpaqueKeys } from "@parle/memory/OpaqueKeys"
import { RULES_VERSION } from "@parle/policy/FrontDoor"
import { Storage as Kept, StorageUnavailable } from "@parle/memory/Storage"
import { Discussion, DiscussionSink } from "@parle/networks/Discussion"
import { HackerNews } from "@parle/networks/HackerNews"
import { Observation, ObservationSink } from "@parle/networks/Observation"
import { Reddit } from "@parle/networks/Reddit"
import { X } from "@parle/networks/X"
import { ExclusionList } from "@parle/policy/ExclusionList"
import { LookupPolicy } from "@parle/policy/LookupPolicy"
import { SubjectIdentity } from "@parle/policy/SubjectIdentity"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as ReadComments from "../ai/Comments.ts"
import { Digesting } from "../ai/Digesting.ts"
import { Enquiry } from "../enquiry/Enquiry.ts"
import { Gathered, Recalled } from "../gathered/Gathered.ts"
import { harvestOn, Harvesting } from "../harvest/Harvesting.ts"
import { LocalCache, readThrough } from "../harvest/LocalCache.ts"
import { Noted } from "../harvest/Noted.ts"
import * as Choices from "../policy/Choices.ts"
import * as Controls from "../policy/Controls.ts"
import { Board } from "../reading/Board.ts"
import { Forgetting } from "../settings/Forgetting.ts"
import { Settings } from "../settings/Settings.ts"

/** What the pipeline offers the background worker. */
export type Pipeline = Board | ReadingWatch | Settings | Forgetting | Harvesting | Noted

export const on = (
  platform: Layer.Layer<WebExt>,
  http: Layer.Layer<HttpClient.HttpClient>
): Layer.Layer<Pipeline> => {
  /** The byte store both halves of the reader's memory sit on. Memoized: one Cache. */
  const bytes = Storage.layer.pipe(Layer.provide(platform))

  /**
   * The reader's own store, and the settings document in it.
   *
   * This is the only thing in the graph that writes to disk, and it is the one
   * thing that must: a per-site pause a service-worker restart forgets is a
   * pause the reader has to keep making. Note what it is NOT — nothing about
   * what they read is written here, only what they decided.
   *
   * It is built FIRST because harvesting is governed by it. See below.
   */
  const settings = Settings.layer.pipe(Layer.provide(bytes))

  /**
   * `ReaderChoices` over that document rather than `@parle/policy`'s in-memory
   * default, and `Controls` reading the per-Network switches from it.
   *
   * Both are provided the SAME memoized `settings` layer, so the switch the
   * settings page wrote and the pause the panel wrote are one document. Two
   * layers over two documents is the version of this bug where every control
   * looks present and half of them are inert.
   */
  const choices = Choices.layer.pipe(Layer.provide(settings))
  const controls = Controls.layer.pipe(Layer.provide(settings))

  /**
   * The one durable store, and the whole harvest subgraph over it.
   *
   * `harvestOn` is given the read-WRITE view of the cache and is the only thing
   * in this graph that is. See `harvest/Harvesting.ts` for what that buys.
   *
   * It is also given `choices`, the same instance `LookupPolicy` decides
   * against, because harvesting is not free and must not outrun the first-run
   * question: the harvest content script is IN the manifest, so it starts on
   * the reader's first visit to X whether or not they have read anything, and
   * resolving a `t.co` link is a real request to a third party. Read the
   * `Layer.provide` as the enforcement — a harvest that ignored the reader's
   * answer would require taking this argument away.
   */
  const localCache = LocalCache.layer.pipe(Layer.provide(bytes))
  const harvest = harvestOn(localCache, choices)

  /**
   * The Enquiry's view of the same cache: everything Harvest wrote is readable,
   * and nothing a Lookup produces is writable.
   *
   * `Layer.fresh` is load-bearing rather than decorative. `Recollection.layer` is
   * one layer instance and layers are memoized by instance, so building it here
   * and inside `harvestOn` without it would yield ONE `Recollection` — whichever
   * of the two `Kept` views happened to be built first — and the seam this whole
   * arrangement exists for would silently not exist. It would also fail in the
   * dangerous direction half the time.
   */
  const recallKept = Layer.effect(
    Kept,
    Effect.map(LocalCache, (held) => Kept.of(readThrough(held.kept)))
  ).pipe(Layer.provide(localCache))
  const recollection = Layer.fresh(Recollection.layer).pipe(Layer.provide(recallKept))

  /**
   * The negative memory, on its own durable view of the same byte store.
   *
   * Deliberately NOT on `recallKept`. That view exists to keep Lookup-derived
   * Mentions off the disk (ADR 0012), and it is bounded to the Local Discussion
   * Cache's own prefix — a front-door judgement written through it would live in
   * the heap for one worker lifetime and then be gone, which is most of them.
   *
   * It is a durable record of a site the reader opened, so its keys are
   * concealed through the same `OpaqueKeys` the Lookup Record uses. Both need
   * only to RECOGNISE an address, never to read one back, so concealing costs
   * nothing and removes the address from an unencrypted profile directory.
   *
   * `RULES_VERSION` is passed in rather than read inside, so that changing the
   * rule in `@parle/policy` invalidates every judgement made by the old one
   * without anything else having to know.
   */
  const durableKept = Layer.effect(
    Kept,
    Effect.map(Storage, (bytes) =>
      Kept.of({
        get: (key) =>
          bytes.get(key).pipe(
            Effect.map(Option.map(asText)),
            Effect.catch((cause) =>
              Effect.fail(new StorageUnavailable({ operation: "get", key, detail: String(cause) }))
            )
          ),
        set: (key, value) =>
          bytes.set(key, value).pipe(
            Effect.catch((cause) =>
              Effect.fail(new StorageUnavailable({ operation: "set", key, detail: String(cause) }))
            )
          ),
        remove: (key) =>
          bytes.remove(key).pipe(
            Effect.catch((cause) =>
              Effect.fail(new StorageUnavailable({ operation: "remove", key, detail: String(cause) }))
            )
          ),
        keys: (prefix) =>
          bytes.keys.pipe(
            Effect.map((all) => all.filter((key) => key.startsWith(prefix))),
            Effect.catch((cause) =>
              Effect.fail(new StorageUnavailable({ operation: "keys", key: prefix, detail: String(cause) }))
            )
          )
      }))
  ).pipe(Layer.provide(bytes))

  /**
   * One salt, shared. `OpaqueKeys.layer` is one instance and layers are
   * memoized by instance, so the Front Door memory and the Lookup Record
   * conceal through the same salt — which is also what lets ADR 0015's finer
   * clearing control sweep both by prefix and leave nothing orphaned.
   */
  const opaque = OpaqueKeys.layer.pipe(Layer.provide(durableKept))

  const frontDoors = FrontDoorMemory.layer(RULES_VERSION).pipe(
    Layer.provide(durableKept),
    Layer.provide(opaque)
  )

  /**
   * The record of what we intended to ask, written before each request — wired
   * at last, and deliberately less than the file's own machinery offers.
   *
   * `Enquiry.consult` gates re-asks on the LEASE alone (`intended`), never on a
   * settled answer (`asked`). The reason this store sat unwired is still true:
   * skipping a Lookup because we asked recently is only safe if something can
   * still answer, and the Harvest-filled half holds the pages the reader SAW,
   * not the ones they visited — an `asked`-keyed skip would draw an empty panel
   * on the ordinary revisit, which is ADR 0005's durable false negative. A
   * lease-keyed skip has neither problem: it declines only to pay twice for a
   * request already in flight, costs at most one lease window after a crash,
   * and is overridable from the panel. What it buys is the property ADR 0001
   * lists among the terms of the X decision — "at most once per long TTL" can
   * survive the worker being killed mid-flight, instead of resetting to "once
   * per worker lifetime".
   */
  const lookupRecord = LookupRecord.layer.pipe(
    Layer.provide(durableKept),
    Layer.provide(opaque)
  )

  /**
   * One Exclusion List, referenced twice and memoized once.
   *
   * `LookupPolicy` decides against it and `Board` asks it which rule covers an
   * address so the panel can say. Two layers here would be two lists — the
   * panel explaining a decision the policy did not make — which is worse than
   * no explanation, because it is a wrong one the reader would act on.
   */
  const exclusions = ExclusionList.layer.pipe(Layer.provide(choices))

  const policy = LookupPolicy.layer.pipe(
    Layer.provide(Layer.mergeAll(controls, exclusions, choices))
  )

  /**
   * Both clearing controls, over both halves.
   *
   * `Forgetting` sweeps the durable keys by prefix — which now reach something,
   * where before they reached an empty store — and then clears the heap the
   * running worker is answering from, through the read-through view. The finer
   * Lookup-Record-only control still touches `parle/lookup/` and nothing else,
   * which is ADR 0015's whole point: a reader worried about the record of what
   * we ASKED is not made to throw away harvested work that was never a privacy
   * liability and is expensive to rebuild.
   */
  const forgetting = Forgetting.layer.pipe(
    Layer.provide(Layer.mergeAll(bytes, recollection))
  )

  const connectors = Layer.mergeAll(
    HackerNews.layer.pipe(Layer.provide(http)),
    Reddit.layer.pipe(Layer.provide(http)),
    X.layer
  )

  /**
   * The two `Context.Reference`s the connectors deposit row data into.
   *
   * Merged at the top rather than provided to the connectors: a Reference's
   * `Identifier` is `never`, so `Layer.provide` has nothing to match on, and
   * the only reliable way to put one in a runtime's context is to merge it into
   * the context that runtime is built from. `Gathered.layer` is referenced
   * twice and memoized once, so both sides see the same store.
   */
  const sinks = Layer.unwrap(
    Effect.gen(function*() {
      const gathered = yield* Gathered
      return Layer.mergeAll(
        Layer.succeed(DiscussionSink, { note: gathered.note }),
        Layer.succeed(ObservationSink, { observe: gathered.observe })
      )
    })
  ).pipe(Layer.provide(Gathered.layer))

  /**
   * The Digest, wired at last — and wired so that it can do nothing on its own.
   *
   * Three seams meet here and each one is inert until the reader asks:
   *
   *   - `Digests` is `@parle/digest`'s pure service. It selects, it prompts, it
   *     admits. It reaches no network by itself.
   *   - `ReadComments` is the only thing in the build that fetches comment
   *     BODIES. That is more traffic than every Lookup on a page put together,
   *     which is why `Enquiry.summarise` is its one caller and the reader's own
   *     click is that caller's one trigger.
   *   - `Digesting` builds the Provider layer per request from the settings
   *     document, so a key pasted into the settings page works on the next
   *     Digest rather than on the next service-worker restart.
   *
   * The HTTP client is the same paced one the connectors sit on, so reading
   * comments spends from a named bucket rather than from nowhere — see
   * `Client.keyOf`.
   */
  const digesting = Digesting.layer.pipe(
    Layer.provide(
      Layer.mergeAll(settings, ReadComments.layer.pipe(Layer.provide(http)), Digests.layer, http)
    )
  )

  const enquiry = Enquiry.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        SubjectIdentity.layer,
        policy,
        // The same memoized `Controls` that is inside `policy`, so wave one and
        // the Lookups cannot disagree about which switches the reader has moved.
        controls,
        recollection,
        frontDoors,
        lookupRecord,
        Gathered.layer,
        connectors,
        digesting
      )
    )
  )

  const board = Board.layer.pipe(
    Layer.provide(Layer.mergeAll(enquiry, SubjectIdentity.layer, exclusions))
  )

  const reading = ReadingWatch.layer.pipe(Layer.provide(Tabs.layer), Layer.provide(platform))

  /**
   * How a recalled Mention gets a row.
   *
   * Wave one answers from the reader's own disk with no Lookup behind it, so
   * nothing described its Discussions to `Gathered` — and `panelOf` skips a
   * Mention it cannot draw. Without this the cache hit ADR 0012 exists for
   * renders as an empty panel on any worker restarted since the harvest, which
   * is most of them.
   *
   * Merged at the top, like the connectors' sinks and for the same reason: it is
   * a `Context.Reference`, read per call rather than at layer build.
   */
  const recalled = Layer.unwrap(
    Effect.gen(function*() {
      const noted = yield* Noted
      const memory = yield* Recollection
      return Layer.succeed(Recalled, {
        describe: Effect.fn("Recalled.describe")(function*(ids) {
          const seen = yield* noted.describe(ids)
          const observations: Array<Observation> = []
          for (const id of ids) {
            const held = yield* memory.latest(id)
            if (Option.isNone(held)) continue
            observations.push(Observation.make({
              discussion: held.value.discussion,
              receivedAt: held.value.receivedAt,
              // `undefined` is "the page did not say", which is not zero. A
              // zero here renders later as a score that fell to nothing.
              score: held.value.score ?? null,
              comments: held.value.comments ?? null,
              present: held.value.stillListed
            }))
          }
          return {
            discussions: seen.map((one) =>
              Discussion.make({
                id: one.id,
                title: one.title,
                submittedUrl: one.submittedUrl,
                postedAt: one.postedAt,
                author: one.author
              })
            ),
            observations
          }
        })
      })
    })
  ).pipe(Layer.provide(Layer.mergeAll(harvest, recollection)))

  return Layer.mergeAll(board, reading, sinks, settings, forgetting, harvest, recalled)
}
