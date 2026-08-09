/**
 * `@parle/policy`'s `ReaderChoices`, backed by the reader's own store.
 *
 * The package ships `ReaderChoices.inMemory`, and its own doc comment says why
 * that is deliberately wrong for the extension: "a pause that a service-worker
 * restart forgets is a pause the reader has to keep making." This file is the
 * substitution it anticipates — the same service key, over {@link Settings}.
 *
 * It is a projection, not a second store. `Choices` is the slice of the
 * reader's settings that `LookupPolicy` reads; the per-Network switches are the
 * slice `Controls` reads. Keeping them in one document and two views is what
 * stops the settings page and the Lookup path disagreeing about what the reader
 * said — the failure that would make every one of these controls look present
 * and be inert.
 *
 * `manualOnly` is `automatic` inverted, and the inversion is deliberate. The
 * reader's switch is worded positively ("look things up automatically"), which
 * is what a switch that is ON by default has to be; policy's is worded as the
 * restriction it imposes. One of the two has to be negated and it is better
 * done here, once, than in the sentence on the settings page.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { Choices, SitePattern } from "@parle/policy/ReaderChoices"
import { ReaderChoices } from "@parle/policy/ReaderChoices"
import {
  type ReaderSettings,
  Settings,
  withAllowAnyway,
  withExclusion,
  withoutPause,
  withPause
} from "../settings/Settings.ts"

/**
 * The slice of the reader's settings that `LookupPolicy` decides against.
 *
 * `manualOnly` is true until the reader has been asked AND said yes, and that
 * conjunction is the whole first-run disclosure as an enforced property rather
 * than a screen someone remembered to show. `LookupPolicy` reads this on every
 * automatic decision, so a fresh install issues no Lookup on any page — not one
 * — before the question has been answered, whatever order the background, the
 * pill and the popup happen to start in.
 *
 * The reader-initiated path is deliberately not affected: ADR 0005 requires the
 * toolbar to work on every page, `LookupPolicy` lets a reader-initiated Ask past
 * `manualOnly`, and a reader who clicks "look this page up" on the first-run
 * screen's own example has asked for exactly one Lookup and gets exactly one.
 */
export const choicesOf = (settings: ReaderSettings): Choices => ({
  excluded: settings.excluded,
  allowedAnyway: settings.allowedAnyway,
  paused: settings.paused,
  manualOnly: !settings.decided || !settings.automatic
})

export const layer: Layer.Layer<ReaderChoices, never, Settings> = Layer.effect(
  ReaderChoices,
  Effect.gen(function*() {
    const settings = yield* Settings

    const current = Effect.map(settings.current, choicesOf)

    const pauseSite = Effect.fn("Choices.pauseSite")(function*(host: string) {
      yield* settings.change((held) => withPause(held, host))
    })

    const resumeSite = Effect.fn("Choices.resumeSite")(function*(host: string) {
      yield* settings.change((held) => withoutPause(held, host))
    })

    const exclude = Effect.fn("Choices.exclude")(function*(pattern: SitePattern) {
      yield* settings.change((held) => withExclusion(held, pattern))
    })

    const allowAnyway = Effect.fn("Choices.allowAnyway")(function*(pattern: SitePattern) {
      yield* settings.change((held) => withAllowAnyway(held, pattern))
    })

    return ReaderChoices.of({ current, pauseSite, resumeSite, exclude, allowAnyway })
  })
)
