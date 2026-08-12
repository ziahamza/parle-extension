/**
 * What crosses between the background and a surface.
 *
 * The background sends whole `Panel`s — complete state, never deltas and never
 * events. A surface that receives state cannot be wrong about a frame it
 * missed, which is what makes a panel opened three seconds into an Enquiry
 * correct; a surface that receives events is only correct if it has seen all of
 * them, and under MV3 it demonstrably has not, because the worker is killed and
 * restarted underneath it without notice.
 *
 * It sends a derived `Panel` rather than a `Reading` for a second reason, and
 * this one is a real trade. `Reading` is built from `@parle/domain`'s schemas,
 * so decoding one on the far side drags Effect's `Schema` into the script that
 * gets injected into the reader's page — measured at ~80 kB there against ~10 kB
 * without it. ADR 0003 makes the iOS build the constraining platform, so the
 * derivation stays in the background and the wire carries plain data.
 *
 * The cost of that is stated plainly: these guards are hand-written rather than
 * `Schema`-decoded, which is against the grain of the rest of the codebase.
 * They are acceptable here and nowhere else, because both ends of this channel
 * are our own code shipped in one artifact — a web page cannot post to an
 * extension port. Everything that actually arrives from a third party, which is
 * every Network answer and every Provider response, is decoded through `Schema`.
 */
import type { Network } from "@parle/domain/Network"
import type { Decision } from "../reading/Surroundings.ts"
import type { MarkPark } from "../view/MarkPark.ts"
import { isMarkPark } from "../view/MarkPark.ts"
import type { Panel } from "../view/Panel.ts"

/** Named ports, so the background can tell a panel from a pill. */
export const PANEL_PORT = "parle-panel"
export const PILL_PORT = "parle-pill"
/**
 * The surface beside the page, where the browser gives us one.
 *
 * Its own name rather than the toolbar's, because the two have opposite
 * lifetimes and the background has to be able to tell them apart in a log: the
 * toolbar panel dies when the reader looks away, and this one outlives tabs.
 */
export const ASIDE_PORT = "parle-aside"
/** The first-run page, which asks the one question and reports the answer. */
export const DISCLOSURE_PORT = "parle-disclosure"
/**
 * The settings page.
 *
 * It owns its own `Settings` layer over the same store the background reads, so
 * this port carries only the two things a page cannot do for itself: clearing
 * the stores the running worker is holding, and nothing else.
 */
export const SETTINGS_PORT = "parle-settings"
/**
 * The harvest content script, on the three Networks the reader browses.
 *
 * Its own port, and that is not tidiness. `Harvester.offer` back-pressures — it
 * suspends its caller rather than dropping a Discussion, which is the guarantee
 * `@parle/harvest` is built around — and the background reads each port's
 * messages in order on one fiber. On a shared port a full harvest pipeline would
 * therefore stall the reader's next panel frame. On this one it stalls the next
 * page of harvest, which is exactly what suspending is supposed to mean.
 */
export const HARVEST_PORT = "parle-harvest"

/**
 * What this browser can put beside the page, rather than on top of it.
 *
 * Measured, not assumed. Chrome has `sidePanel`, which is real browser chrome:
 * opening it shrinks the page's own viewport (1279 → 893 at the default width
 * on a 1280 window) so the article reflows beside it instead of being covered.
 * Safari has no such API on macOS or iOS, and ADR 0003 makes iOS the
 * constraining platform — so `in-page` is not a fallback, it is what the
 * majority of the shipped targets get and the one that has to be complete.
 *
 * It travels on the wire as a field on {@link Standing} rather than being read
 * from a `chrome.*` namespace at the surface, because ADR 0003 keeps every
 * extension API inside `src/platform` and ADR 0011 makes a capability the
 * reader's browser lacks a *state* that gets rendered, not an error thrown or a
 * build flag branched on. Nothing outside `src/platform` names a browser.
 */
export type AsideKind = "native" | "in-page"

/** What a surface says to the background. */
export type Ask =
  /** Send me this tab's state, now and whenever it changes. `null` = the active tab. */
  | { readonly _tag: "Watch"; readonly tabId: number | null }
  /**
   * A content script reporting the page it is actually on.
   *
   * The background already knows the address from `tabs.onUpdated`; what only
   * the page can supply is its referrer, which is the reader's own arrival and
   * belongs on the Reading rather than on any Mention.
   */
  | {
    readonly _tag: "Sighted"
    readonly address: string
    readonly title: string
    readonly referrer: string
  }
  /** Open a Discussion. Routed through the background so the surface needs no permission. */
  | { readonly _tag: "OpenOut"; readonly address: string }
  /**
   * The reader asked for this page on purpose.
   *
   * A distinct Ask rather than a flag on `Watch` because it is a different
   * *act*: ADR 0005 promises the toolbar works on every page, so this overrides
   * the exclusion list, a per-site pause and manual mode — and something that
   * overrides all three has to be something the reader did, not something a
   * surface can imply by subscribing.
   */
  | { readonly _tag: "LookAnyway" }
  /**
   * The reader asked for a Digest of this page's Discussions.
   *
   * Its own Ask, and it has to be, because it is the only thing a surface can
   * say that causes comment BODIES to be fetched — several requests, far more
   * than the Lookups that found the Discussions in the first place — and then
   * spends the reader's own Provider quota on them. A flag on `Watch` would
   * make that a consequence of a panel opening, which is exactly what the panel
   * telling the reader what it is about to do exists to prevent.
   */
  | { readonly _tag: "Summarise" }
  /**
   * Open, or close, one Discussion's comments.
   *
   * Carries the Discussion's key rather than its permalink: the background
   * looks it up in the Enquiry it is already holding, so a surface cannot ask
   * about a Discussion this page never found.
   */
  | { readonly _tag: "ReadDiscussion"; readonly key: string }
  /** The answer to the first-run question, or a later change of mind. */
  | { readonly _tag: "Decide"; readonly automatic: boolean }
  /** Show the page that says what Parle sends and to whom. */
  | { readonly _tag: "OpenDisclosure" }
  /**
   * The reader clicked the mark, and this browser has a surface beside the page.
   *
   * **The one Ask on this wire that is answered before the Effect runtime sees
   * it, and it has to be.** `chrome.sidePanel.open()` may only be called while
   * the frame that sent this still has transient user activation, AND only from
   * the turn the message was delivered in. Measured on Chrome 151, twice,
   * independently: the activation survives `port.postMessage` from a content
   * script into the background — including from inside a closed shadow root —
   * but it does not survive a single microtask. `queueMicrotask`, `await null`,
   * `Promise.resolve().then`, `setTimeout(0)` and `await chrome.tabs.get()`
   * before the call all fail identically with
   *
   *   "`sidePanel.open()` may only be called in response to a user gesture."
   *
   * while 10ms of *synchronous* work before it passes. The window is not time,
   * it is the turn. Every handler in `background.ts` runs on an Effect fiber,
   * which is at minimum one microtask after `port.onMessage` — so the open is
   * done in the raw listener in `platform/Extension.ts`, and this arm exists so
   * that the wire's vocabulary is in one place and the no-op below is where a
   * reviewer meets the reason.
   *
   * A surface only sends this where {@link AsideKind} is `native`. Where it is
   * `in-page` the mark opens its own surface directly and nothing crosses.
   */
  | { readonly _tag: "OpenAside" }
  /**
   * Stop, or start again, on one site.
   *
   * Carried by host rather than by tab because that is what it means: a pause
   * is about the site, and the reader who sets it on one tab expects it to hold
   * on the next one. It is here — on the wire every surface already speaks —
   * rather than only on the settings page, because the moment a reader wants to
   * pause a site is the moment they are looking at it.
   */
  | { readonly _tag: "PauseSite"; readonly host: string }
  | { readonly _tag: "ResumeSite"; readonly host: string }
  /** Show the settings page. */
  | { readonly _tag: "OpenSettings" }
  /**
   * The settings page wrote to the settings document.
   *
   * The page owns its own `Settings` layer over the same store, so the write
   * itself needs no help — and `LookupPolicy` re-reads the document on every
   * decision, so ENFORCEMENT is already correct without this. What is not
   * correct without it is what the panel SAYS: the background holds the
   * reader's decision and their per-Network switches in a `SubscriptionRef`, to
   * redraw every attached surface when they change, and nothing was telling it
   * they had. A reader who turned automatic lookups on from the settings page
   * got an extension that looked pages up while every panel went on insisting
   * it had not started yet.
   *
   * It carries no payload on purpose. The document is the truth and the
   * background re-reads it; sending the new value would be a second copy that
   * can disagree with the first.
   */
  | { readonly _tag: "SettingsChanged" }
  /**
   * Throw away what this device remembers.
   *
   * Two scopes, never one, because ADR 0015 separates two stores whose privacy
   * properties are opposite — see the settings page for the sentence each one
   * gets. It crosses the wire rather than being done where it is asked for
   * because the background is the only context holding the live stores; a
   * settings page clearing bytes on its own would leave the running worker
   * answering from a memory the reader was told had gone.
   */
  | { readonly _tag: "Forget"; readonly scope: "everything" | "lookup-record" }
  /**
   * A Network page the reader was already looking at, as its own markup.
   *
   * ADR 0012's crawl is the reader browsing, so this is the crawl. It carries
   * markup rather than a parsed result for two reasons and the second decides
   * it: the parsers live in `@parle/harvest` and must be one implementation, and
   * there is no `DOMParser` in an MV3 service worker — so the background could
   * not build a tree even if it wanted one, and the content script must not be
   * the thing that decides what a Discussion is.
   *
   * Nothing here is stored. The markup is read once, turned into Mentions and
   * Observations, and discarded; what reaches disk is pointers and numbers.
   */
  | {
    readonly _tag: "Harvested"
    readonly network: Network
    /** The address of the Network page itself. Relative hrefs resolve against it. */
    readonly address: string
    readonly markup: string
  }
  /**
   * The reader dragged the on-page mark to a new place.
   *
   * Fractions of the viewport, not pixels — see {@link MarkPark}. Carried as
   * its own Ask rather than a settings edit because parking the mark is not a
   * privacy decision and must not rewrite the settings document.
   */
  | { readonly _tag: "ParkMark"; readonly park: MarkPark }

/** What the background says to a surface. */
export type Word =
  | {
    readonly _tag: "Standing"
    readonly tabId: number
    readonly panel: Panel
    /**
     * What this browser can put beside the page — see {@link AsideKind}.
     *
     * On the frame rather than sent once at connect time, and that removes a
     * race rather than adding a field. The mark does not exist until a frame
     * carrying a Discussion has arrived, so by the time there is anything to
     * click, this has been answered. A surface can never be in the position of
     * having to guess.
     */
    readonly aside: AsideKind
    /** Where the reader last parked the mark. Top-right until they move it. */
    readonly markPark: MarkPark
  }
  /** What the reader has said about automatic lookups. For the first-run page. */
  | { readonly _tag: "Told"; readonly decision: Decision }

export const Watch = (tabId: number | null): Ask => ({ _tag: "Watch", tabId })
export const Sighted = (address: string, title: string, referrer: string): Ask => ({
  _tag: "Sighted",
  address,
  title,
  referrer
})
export const OpenOut = (address: string): Ask => ({ _tag: "OpenOut", address })
export const LookAnyway = (): Ask => ({ _tag: "LookAnyway" })
export const Summarise = (): Ask => ({ _tag: "Summarise" })

export const ReadDiscussion = (key: string): Ask => ({ _tag: "ReadDiscussion", key })
export const Decide = (automatic: boolean): Ask => ({ _tag: "Decide", automatic })
export const OpenDisclosure = (): Ask => ({ _tag: "OpenDisclosure" })
export const OpenAside = (): Ask => ({ _tag: "OpenAside" })
export const PauseSite = (host: string): Ask => ({ _tag: "PauseSite", host })
export const ResumeSite = (host: string): Ask => ({ _tag: "ResumeSite", host })
export const OpenSettings = (): Ask => ({ _tag: "OpenSettings" })
export const SettingsChanged = (): Ask => ({ _tag: "SettingsChanged" })
export const Forget = (scope: "everything" | "lookup-record"): Ask => ({ _tag: "Forget", scope })
export const Harvested = (network: Network, address: string, markup: string): Ask => ({
  _tag: "Harvested",
  network,
  address,
  markup
})
export const ParkMark = (park: MarkPark): Ask => ({ _tag: "ParkMark", park })
export const Standing = (
  tabId: number,
  panel: Panel,
  aside: AsideKind,
  markPark: MarkPark
): Word => ({
  _tag: "Standing",
  tabId,
  panel,
  aside,
  markPark
})
export const Told = (decision: Decision): Word => ({ _tag: "Told", decision })

const tagOf = (raw: unknown): string | null =>
  typeof raw === "object" && raw !== null && "_tag" in raw &&
    typeof (raw as { _tag: unknown })._tag === "string"
    ? (raw as { _tag: string })._tag
    : null

const stringAt = (raw: unknown, key: string): string | null => {
  const value = (raw as Record<string, unknown>)[key]
  return typeof value === "string" ? value : null
}

/**
 * Read an Ask, or nothing.
 *
 * A frame that does not narrow is dropped rather than half-applied. That is
 * only safe because what we send is state: the next frame is complete, so
 * missing this one loses nothing.
 */
export const hearAsk = (raw: unknown): Ask | null => {
  switch (tagOf(raw)) {
    case "Watch": {
      const tabId = (raw as { tabId?: unknown }).tabId
      if (tabId === null || tabId === undefined) return Watch(null)
      return typeof tabId === "number" ? Watch(tabId) : null
    }
    case "Sighted": {
      const address = stringAt(raw, "address")
      const title = stringAt(raw, "title")
      const referrer = stringAt(raw, "referrer")
      return address === null || title === null || referrer === null
        ? null
        : Sighted(address, title, referrer)
    }
    case "OpenOut": {
      const address = stringAt(raw, "address")
      return address === null ? null : OpenOut(address)
    }
    case "LookAnyway":
      return LookAnyway()
    case "Summarise":
      return Summarise()
    case "ReadDiscussion": {
      const key = stringAt(raw, "key")
      return key === null ? null : ReadDiscussion(key)
    }
    case "Decide": {
      const automatic = (raw as { automatic?: unknown }).automatic
      // Dropped rather than defaulted. Guessing here would guess about the one
      // question this extension is obliged to have asked out loud.
      return typeof automatic === "boolean" ? Decide(automatic) : null
    }
    case "OpenDisclosure":
      return OpenDisclosure()
    case "OpenAside":
      return OpenAside()
    case "PauseSite": {
      const host = stringAt(raw, "host")
      return host === null || host === "" ? null : PauseSite(host)
    }
    case "ResumeSite": {
      const host = stringAt(raw, "host")
      return host === null || host === "" ? null : ResumeSite(host)
    }
    case "OpenSettings":
      return OpenSettings()
    case "SettingsChanged":
      return SettingsChanged()
    case "Forget": {
      // Narrowed rather than defaulted: the two scopes are deliberately
      // different sizes of destruction, and guessing between them is the one
      // guess this wire must never make.
      const scope = stringAt(raw, "scope")
      return scope === "everything" || scope === "lookup-record" ? Forget(scope) : null
    }
    case "Harvested": {
      // The Network is narrowed against the closed list rather than cast. A page
      // claiming to be from a Network we do not read is exactly the input a
      // parser must never be handed — `@parle/harvest` dispatches on this field
      // and its `switch` is exhaustive with no default arm.
      const network = stringAt(raw, "network")
      const address = stringAt(raw, "address")
      const markup = stringAt(raw, "markup")
      if (address === null || markup === null) return null
      if (network !== "hackernews" && network !== "reddit" && network !== "x") return null
      return Harvested(network, address, markup)
    }
    case "ParkMark": {
      const park = (raw as { park?: unknown }).park
      return isMarkPark(park) ? ParkMark(park) : null
    }
    default:
      return null
  }
}

/**
 * Is this the one Ask that has to be answered in the turn it arrived?
 *
 * Split out from {@link hearAsk} so the raw port listener can ask the question
 * without paying for the whole switch, and — more to the point — so that the
 * only place outside this file that recognises `OpenAside` still gets its
 * answer from this file. A hand-rolled `raw._tag === "OpenAside"` in
 * `platform/Extension.ts` would be a second reader of this wire, and this wire
 * has exactly two.
 *
 * It is a plain synchronous predicate over `unknown` and must stay one. See
 * `OpenAside` above for what an `await` in front of the call costs.
 */
export const isOpenAside = (raw: unknown): boolean => tagOf(raw) === "OpenAside"

const isDecision = (value: unknown): value is Decision =>
  value === "undecided" || value === "automatic" || value === "manual"

const isAsideKind = (value: unknown): value is AsideKind =>
  value === "native" || value === "in-page"

export const hearWord = (raw: unknown): Word | null => {
  switch (tagOf(raw)) {
    case "Standing": {
      const said = raw as {
        tabId?: unknown
        panel?: unknown
        aside?: unknown
        markPark?: unknown
      }
      if (typeof said.tabId !== "number") return null
      const panel = said.panel
      if (typeof panel !== "object" || panel === null) return null
      if (!Array.isArray((panel as Panel).linked)) return null
      if (!Array.isArray((panel as Panel).accounts)) return null
      // Narrowed rather than defaulted, like `Decide` and `Forget` above. A
      // guess either way is a guess about which surface the mark opens: guess
      // `native` on Safari and the mark does nothing at all, guess `in-page` on
      // Chrome and the reader gets two copies of one Discussion list.
      if (!isAsideKind(said.aside)) return null
      // Optional on the wire for one release so an older surface that has not
      // yet been reloaded still paints; a missing park is the historic corner.
      const markPark = isMarkPark(said.markPark) ? said.markPark : { x: 1, y: 0 }
      return Standing(said.tabId, panel as Panel, said.aside, markPark)
    }
    case "Told": {
      const decision = (raw as { decision?: unknown }).decision
      return isDecision(decision) ? Told(decision) : null
    }
    default:
      return null
  }
}
