/**
 * The settings page: the only screen in the product that is entirely about the
 * reader rather than about a page.
 *
 * It reads and writes the settings document **directly**, over the same
 * `@parle/browser` Storage seam the background reads it from. Extension pages
 * and the service worker share one origin, so they share one store; and because
 * the background re-reads the document on every decision rather than caching
 * it, a switch flipped here is in force on the next Lookup with no restart, no
 * message and no invalidation to get wrong.
 *
 * Exactly one thing cannot be done that way, and it goes over a port: clearing
 * what this device remembers. The stores live in the background's heap as well
 * as on disk, so a page that cleared bytes on its own would leave the running
 * worker answering from a memory the reader had just been told was gone.
 *
 * Every act persists FIRST and redraws from what came back. The screen is
 * therefore incapable of showing a state the store does not hold — a checkbox
 * that stays ticked after the write failed is exactly the bug that makes a
 * privacy control untrustworthy, and optimistic rendering is how you get one.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import type { Network } from "@parle/domain/Network"
import { Storage } from "@parle/browser/Storage"
import { WebExt } from "@parle/browser/WebExtApi"
import type { SitePattern } from "@parle/policy/ReaderChoices"
import { seed } from "@parle/policy/Seed"
import { X_LOOKUP_COMPILED_IN } from "../../policy/Controls.ts"
import { link } from "../../platform/Surface.ts"
import {
  readSite,
  type ReaderSettings,
  Settings,
  siteLabel,
  withAllowAnyway,
  withAutomatic,
  withByok,
  withCodex,
  withEveryDiscussion,
  withExclusion,
  withNetwork,
  withoutAllowAnyway,
  withoutExclusion,
  withoutPause,
  withoutProviderKey,
  withProviderConnection
} from "../../settings/Settings.ts"
import { SETTINGS_STYLES } from "../../view/settingsStyles.ts"
import { renderSettings, type SettingsActs } from "../../view/settingsView.ts"
import { FORGETTING, PROVIDER, SKIPPED } from "../../view/settingsCopy.ts"
import { Forget, SETTINGS_PORT, SettingsChanged } from "../../wire/Wire.ts"

const style = document.createElement("style")
style.textContent = SETTINGS_STYLES
document.head.appendChild(style)

const root = document.getElementById("settings")

if (root !== null) {
  const runtime = ManagedRuntime.make(
    Settings.layer.pipe(Layer.provide(Storage.layer), Layer.provide(WebExt.layer))
  )

  /** The background, for the one thing this page cannot do for itself. */
  const wire = link(SETTINGS_PORT, () => {})

  const compiledOut: ReadonlyArray<Network> = X_LOOKUP_COMPILED_IN ? [] : ["x"]

  let notice: string | null = null

  /**
   * Whether this browser has a model on it, asked of the browser itself.
   *
   * Probed here rather than in the background because this is the only screen
   * that offers the choice, and probed once per page load rather than per
   * render because a model does not appear while somebody ticks a box. It
   * starts `false` and redraws if the answer turns out to be yes, so a browser
   * with no `LanguageModel` at all — Safari, and every Chrome before 138 —
   * simply never sees the option enabled.
   *
   * `downloadable` is deliberately NOT counted. Selecting a Provider must not
   * be what starts a multi-gigabyte download; `@parle/provider`'s on-device
   * layer takes the same view and substitutes the unconnected Provider.
   */
  let onDevice = false

  const draw = (settings: ReaderSettings): void => {
    renderSettings(
      root,
      { settings, artifact: seed, compiledOut, onDevice, notice },
      acts
    )
  }

  const probeOnDevice = (): void => {
    const model = (globalThis as { LanguageModel?: { availability?: () => Promise<string> } })
      .LanguageModel
    if (model?.availability === undefined) return
    void model.availability().then((said) => {
      if (said !== "available") return
      onDevice = true
      redraw()
    }, () => {})
  }

  /**
   * Persist one edit, then redraw from what was persisted.
   *
   * `said` is the one line of feedback for the act. It is cleared by the *next*
   * act rather than on a timer: a message that disappears on its own is one a
   * reader can miss entirely, and the messages here are about destruction.
   */
  const commit = (
    edit: (settings: ReaderSettings) => ReaderSettings,
    said: string | null = null
  ): void => {
    notice = said
    void runtime.runPromise(Effect.flatMap(Settings, (settings) => settings.change(edit)))
      .then((settings) => {
        // Told AFTER the write has landed, so the background's re-read cannot
        // race it and pick up the old document. It is only ever about what the
        // panels SAY — the next Lookup reads this document itself either way —
        // but a panel that goes on reporting the switch the reader just moved
        // is the same broken promise as a switch that does nothing.
        wire.say(SettingsChanged())
        draw(settings)
      }, () => {})
  }

  const acts: SettingsActs = {
    setNetwork: (network, on) => commit((settings) => withNetwork(settings, network, on)),
    setAutomatic: (on) => commit((settings) => withAutomatic(settings, on)),
    setEveryDiscussion: (on) => commit((settings) => withEveryDiscussion(settings, on)),

    setProvider: (connection) =>
      commit(
        (settings) => withProviderConnection(settings, connection),
        connection === "none" ? null : PROVIDER.chosen(PROVIDER[
          connection === "byok" ? "byok" : connection === "codex" ? "codex" : "onDevice"
        ].name)
      ),

    /**
     * A pasted key, written straight through.
     *
     * The empty string is rejected rather than stored, because "" is what a
     * reader who clicked the button by mistake produces and storing it would
     * silently disconnect the Provider they had already set up.
     */
    setByok: (said) => {
      if (said.apiKey !== undefined && said.apiKey.trim() === "") {
        notice = PROVIDER.byok.missing
        redraw()
        return
      }
      commit(
        (settings) => withByok(settings, said),
        said.apiKey === undefined ? null : PROVIDER.byok.saved
      )
    },
    setCodex: (said) => {
      if (said.token !== undefined && said.token.trim() === "") {
        notice = PROVIDER.byok.missing
        redraw()
        return
      }
      commit(
        (settings) => withCodex(settings, said),
        said.token === undefined ? null : PROVIDER.codex.saved
      )
    },
    forgetProviderKey: (which) =>
      commit((settings) => withoutProviderKey(settings, which), PROVIDER.forgotten),

    addExclusion: (typed) => {
      const pattern = readSite(typed)
      if (pattern === null) {
        notice = SKIPPED.add.rejected
        redraw()
        return
      }
      commit((settings) => withExclusion(settings, pattern), `Parle will skip ${siteLabel(pattern)}.`)
    },
    removeExclusion: (pattern: SitePattern) =>
      commit(
        (settings) => withoutExclusion(settings, pattern),
        `Parle will look up ${siteLabel(pattern)} again.`
      ),

    allowAnyway: (typed) => {
      const pattern = readSite(typed)
      if (pattern === null) {
        notice = SKIPPED.add.rejected
        redraw()
        return
      }
      commit(
        (settings) => withAllowAnyway(settings, pattern),
        `Parle will look up ${siteLabel(pattern)}, even though it is on the built-in list.`
      )
    },
    removeAllowAnyway: (pattern: SitePattern) =>
      commit((settings) => withoutAllowAnyway(settings, pattern)),

    resumeSite: (host) => commit((settings) => withoutPause(settings, host), `Resumed on ${host}.`),

    /**
     * Sent to the background rather than done here.
     *
     * The page redraws immediately afterwards because the settings themselves
     * are untouched by either scope — see the sentence the page shows — so
     * there is nothing to wait for and nothing on screen that could go stale.
     */
    forget: (scope) => {
      wire.say(Forget(scope))
      notice = FORGETTING.done
      redraw()
    }
  }

  const redraw = (): void => {
    void runtime.runPromise(Effect.flatMap(Settings, (settings) => settings.current))
      .then(draw, () => {})
  }

  /**
   * Re-read whenever the reader comes back to this tab.
   *
   * The panel can write to the same document — pausing a site is offered there
   * as well as here — so a settings page left open in another tab can be
   * describing a state that no longer exists. Coming back to the tab is the
   * moment they would notice, so it is the moment to be right; a poll would
   * spend a read every few seconds to be right at moments nobody is looking.
   */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") redraw()
  })

  redraw()
  probeOnDevice()
}
