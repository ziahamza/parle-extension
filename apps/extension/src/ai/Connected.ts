/**
 * Which Provider the reader connected, turned into the one `Provider` layer.
 *
 * `@parle/provider` already owns this decision in `Active.behind`, keyed on a
 * `Context.Reference` read when the layer is built. This file is the same
 * decision keyed on the settings document instead, and the difference is not
 * stylistic.
 *
 * **The choice is read when the reader asks for a Digest, not when the worker
 * starts.** `Active.layer` reads its Reference once, at layer-build time, and
 * the application layer is memoized for the life of the service worker. Under
 * MV3 a worker lives for as long as the reader keeps browsing, so a key pasted
 * into the settings page at 10:00 would not be seen until the worker happened
 * to die — and the panel would go on saying nothing is connected while the
 * settings page showed a key. Building the layer per request costs one
 * allocation and removes that entirely; it is also why {@link connectionOf}
 * takes settings rather than reading them.
 *
 * **It is still exactly ONE branch.** That is the property ADR 0004 actually
 * requires: no caller may know which Provider is active. Everything downstream
 * of `providerFor` sees `Provider` and nothing else, and the four cases exist
 * only here.
 *
 * A reader who selected a Provider and left its credential empty gets the
 * `not-connected` Provider rather than a Provider that will 401. "You have
 * connected nothing" and "your key was rejected" are different states with
 * different words and different offers (ADR 0011), and inventing the second out
 * of the first would tell the reader their key is bad when they never gave one.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Byok from "@parle/provider/Byok"
import * as Codex from "@parle/provider/Codex"
import * as OnDevice from "@parle/provider/OnDevice"
import { Provider, ProviderUnavailable } from "@parle/provider/Provider"
import * as Unconnected from "@parle/provider/Unconnected"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { isSet, type ProviderConnection, type ReaderSettings } from "../settings/Settings.ts"

/** What a Provider is called when it is spelled out for the reader. */
export const PROVIDER_NAMES: Record<ProviderConnection, string> = {
  none: "no Provider",
  byok: "your own API key",
  "on-device": "your browser's built-in model",
  codex: "ChatGPT"
}

/**
 * The model a reader who named none gets.
 *
 * Small, current and cheap, because the Brief is sized for the weakest Provider
 * anyway (`@parle/digest`'s `defaultLimits`) and a reader who has not chosen a
 * model has not chosen to spend more.
 */
export const DEFAULT_BYOK_MODEL = "gpt-4o-mini"

/** What the Codex backend is asked for when the reader named nothing. */
export const DEFAULT_CODEX_MODEL = "gpt-5-codex"

/** Where a reader who named no endpoint spends their key. */
export const DEFAULT_BASE_URL = Byok.openAiBaseUrl

const notConnected = new ProviderUnavailable({
  reason: "not-connected",
  detail: "no Provider has been connected"
})

/**
 * Whether the selected Provider has everything it needs to be asked.
 *
 * The on-device model is deliberately treated as "connected" here without a
 * probe: probing is what `OnDevice.layer` does when it is built, and doing it
 * twice would mean the panel and the Provider could disagree about the same
 * machine. Selecting it and having no model yields `no-model`, which is its own
 * state with its own words.
 */
export const isConnected = (settings: ReaderSettings): boolean => {
  switch (settings.provider.connection) {
    case "none":
      return false
    case "byok":
      return isSet(settings.provider.byok.apiKey)
    case "codex":
      return isSet(settings.provider.codex.token)
    case "on-device":
      return true
  }
}

/** Which Provider is connected, for the reader's own words. */
export const connectionOf = (settings: ReaderSettings): ProviderConnection =>
  isConnected(settings) ? settings.provider.connection : "none"

/** The endpoint a key is spent against, with the default filled in. */
export const baseUrlOf = (settings: ReaderSettings): string =>
  settings.provider.byok.baseUrl === "" ? DEFAULT_BASE_URL : settings.provider.byok.baseUrl

/** The model a Digest will be stamped with, with the default filled in. */
export const modelOf = (settings: ReaderSettings): string => {
  switch (settings.provider.connection) {
    case "byok":
      return settings.provider.byok.model === ""
        ? DEFAULT_BYOK_MODEL
        : settings.provider.byok.model
    case "codex":
      return settings.provider.codex.model === ""
        ? DEFAULT_CODEX_MODEL
        : settings.provider.codex.model
    case "on-device":
      return "the built-in model"
    case "none":
      return "none"
  }
}

/**
 * The reader's key, as `ByokAccess` wants it: an Effect, resolved per request.
 *
 * `Byok.ByokAccess.layerOf` takes a plain string and always succeeds, which
 * would turn an empty key into a request carrying `Bearer ` and a 401 back. The
 * seam is an Effect precisely so that "there is no key" can be a state rather
 * than a wire round trip, so this builds the service directly.
 */
const byokAccess = (settings: ReaderSettings): Layer.Layer<Byok.ByokAccess> =>
  Layer.succeed(
    Byok.ByokAccess,
    Byok.ByokAccess.of({
      baseUrl: baseUrlOf(settings),
      model: modelOf(settings),
      apiKey: isSet(settings.provider.byok.apiKey)
        ? Effect.succeed(settings.provider.byok.apiKey)
        : Effect.fail(notConnected)
    })
  )

const codexAccess = (settings: ReaderSettings): Layer.Layer<Codex.CodexAccess> =>
  isSet(settings.provider.codex.token)
    ? Codex.CodexAccess.layerOf({
      token: Redacted.value(settings.provider.codex.token),
      model: modelOf(settings)
    })
    : Codex.CodexAccess.layerUnconnected(modelOf(settings))

/**
 * The one Provider layer, for the connection the reader chose.
 *
 * The on-device branch falls back to the unconnected Provider at the LAYER
 * level rather than failing to build, exactly as `Active` does: a Safari device
 * has no `LanguageModel` at all, and that must arrive at the panel as an offer
 * to connect something else rather than as a construction failure nobody can
 * act on.
 */
export const providerFor = (
  settings: ReaderSettings
): Layer.Layer<Provider, never, HttpClient.HttpClient> => {
  switch (settings.provider.connection) {
    case "byok":
      return Byok.layer.pipe(Layer.provide(byokAccess(settings)))
    case "codex":
      return Codex.layer.pipe(Layer.provide(codexAccess(settings)))
    case "on-device":
      return OnDevice.orElse(Unconnected.layer).pipe(
        Layer.provide(OnDevice.OnDeviceHost.layerFromBrowser)
      )
    case "none":
      return Unconnected.layer
  }
}
