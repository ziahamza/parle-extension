/**
 * Everything the reader has decided, on disk, in one document.
 *
 * Until this file existed the Exclusion List, the per-site pause and manual
 * mode were enforced and unreachable — the only way to change any of them was
 * to edit `@parle/policy`'s seed and rebuild. That is not a missing feature; it
 * is the product's entire privacy story being unfalsifiable, and it also fails
 * Chrome's Limited Use policy, which requires the disclosure to appear **in the
 * Product's user interface** and not only in the store listing.
 *
 * Three properties are load-bearing and each one is a decision:
 *
 * **One document, not five keys.** A reader who turns Reddit off and adds an
 * exclusion in the same second must not be able to land in a state where one
 * write won and the other was lost. Reading and writing the whole value makes
 * the last writer win *coherently* rather than field by field.
 *
 * **Read fresh on every decision, never captured at layer build.** MV3 kills
 * the service worker without running finalizers and restarts it on demand, so a
 * value read once at start is a value from a lifetime that may have ended
 * before the reader changed anything. It is also what makes "a change takes
 * effect without a restart" true: the options page writes, and the next
 * `LookupPolicy` decision reads what it wrote. There is no invalidation to get
 * wrong because there is no cache.
 *
 * **A storage fault falls back to the last value we actually read, never to the
 * defaults.** The defaults are permissive — everything on, nothing excluded —
 * so treating an unreadable document as "no preferences" would silently widen
 * what we look up at exactly the moment we are least able to explain why. Last
 * known good is the only fallback that can only ever be as permissive as
 * something the reader really chose.
 *
 * Persistence goes through `@parle/browser`'s Storage seam and never through
 * `chrome.*` (ADR 0003). That store is the Cache API, which extension pages and
 * the background service worker share by origin — which is why the options page
 * can own its own layer over the same key instead of proxying every edit
 * through a port.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import type { Network } from "@parle/domain/Network"
import { asText, Storage } from "@parle/browser/Storage"
import type { SitePattern } from "@parle/policy/ReaderChoices"

/** Where the document lives in the reader's own store. */
export const SETTINGS_KEY = "parle/settings/reader"

/** Which Networks are switched on. */
export type NetworkSwitches = { readonly [K in Network]: boolean }

/**
 * Which source of AI capability the reader has connected. Exactly one.
 *
 * The same four values `@parle/provider`'s `Active.Connection` uses, restated
 * here because this is the document that decides it and a settings file that
 * imported the provider package to name its own field would drag the whole AI
 * seam into every context that reads a setting — including the options page.
 */
export type ProviderConnection = "none" | "byok" | "on-device" | "codex"

/**
 * The reader's own API key, and where to spend it.
 *
 * The key is `Redacted` in memory and a plain string on disk, and both halves
 * of that are deliberate.
 *
 * **On disk it is plaintext, because MV3 has no keychain.** There is no
 * credential store a service worker can reach; `chrome.storage` and the Cache
 * API are both readable by anything with access to the profile directory. ADR
 * 0014 already recorded this as the reason a Network refresh token would be a
 * *worse* credential store than the browser's own cookie jar. Pretending
 * otherwise in the UI would be the one lie this project's disclosure model
 * cannot afford, so the settings page says it in the reader's own words rather
 * than implying protection we cannot provide.
 *
 * **In memory it is `Redacted`, because that part we CAN have.** `Redacted`
 * renders as `<redacted>` through `JSON.stringify`, template interpolation and
 * every logger, so the key cannot reach a log line, a span attribute, an error
 * message or the wire by accident — only {@link asDocument} unwraps it, and it
 * is the one function that has to. `Redacted.value` is therefore the string to
 * grep for when asking where a key can travel, and the whole answer in this app
 * is three places: {@link asDocument}, which persists it; {@link isSet}, which
 * only asks whether there is one; and `ai/Connected.ts`, which hands it to the
 * Provider seam that puts it in an `Authorization` header. Anywhere else, a key
 * is a value that renders as `<redacted>`.
 */
export interface ByokSettings {
  readonly apiKey: Redacted.Redacted<string>
  /** An OpenAI-compatible endpoint. Empty means "OpenAI's own". */
  readonly baseUrl: string
  readonly model: string
}

/**
 * A pasted Codex token.
 *
 * ADR 0004 makes "Log in with ChatGPT" the headline Provider and ADR 0014
 * records why the flow is unresolved: Chrome has `identity.launchWebAuthFlow`,
 * Safari's Web Extension API has no equivalent at all, and the loopback
 * redirect the Codex CLI uses is not available to an extension either. So this
 * is the seam and nothing more — a token from somewhere else, held here.
 * Whatever eventually resolves the flow writes this field and nothing else in
 * the extension changes.
 */
export interface CodexSettings {
  readonly token: Redacted.Redacted<string>
  readonly model: string
}

export interface ProviderSettings {
  readonly connection: ProviderConnection
  readonly byok: ByokSettings
  readonly codex: CodexSettings
}

/**
 * The whole of what the reader has said.
 *
 * `excluded` and `allowedAnyway` are the two halves of ticket 03 §6: the reader
 * wins at both ends of the Exclusion List's precedence order, because a
 * built-in layer can be wrong in either direction and only they can tell us
 * which. `paused` is the softer, reversible thing — a host we stop asking about
 * for now, without claiming it belongs on a list of sensitive places.
 */
export interface ReaderSettings {
  readonly networks: NetworkSwitches
  /** Whether anything fires on navigation. The toolbar works either way. */
  readonly automatic: boolean
  /**
   * Whether the reader has been shown what Parle sends, and answered.
   *
   * Separate from {@link ReaderSettings.automatic} because they are separate
   * facts and collapsing them loses the one that matters: `automatic` is what
   * the reader would get, `decided` is whether they were ever asked. Until this
   * is true, nothing automatic runs no matter what `automatic` says — which is
   * what makes "the reader sees this before any address is sent" a property of
   * the code rather than of the order the surfaces happen to open in.
   *
   * Chrome's Limited Use policy requires the disclosure to appear in the
   * product's user interface, not only in the store listing, and enforcement of
   * the 2026 update began on 1 August 2026. A disclosure that could be missed
   * is not one.
   */
  readonly decided: boolean
  readonly excluded: ReadonlyArray<SitePattern>
  readonly allowedAnyway: ReadonlyArray<SitePattern>
  readonly paused: ReadonlyArray<string>
  /**
   * Show Discussions on a site's front page too, instead of folding the old
   * ones away.
   *
   * The one override for the Front Door rule. It is a setting rather than a
   * constant because the rule is a judgement about which conversations are
   * about the page in front of you, and a judgement the reader disagrees with
   * has to be one they can switch off — ADR 0005's objection to any suppressing
   * mechanism is that a false negative is invisible, and a switch is the last
   * of the three answers to that (the other two: it folds rather than deletes,
   * and the toolbar says so on the page where it fired).
   */
  readonly everyDiscussion: boolean
  /**
   * Take me to the Internet Archive's copy instead of the live page.
   *
   * **Off, and the default is the whole disclosure argument.** Every other
   * setting in this document changes what Parle does with a page the reader
   * opened; this one changes which page they end up on, and it changes what is
   * sent as they browse: with it on, the address of every page they read that is
   * not skipped goes to `archive.org` at navigation time, rather than only when
   * they open the panel. That is a real widening of the standing disclosure, so
   * it is something the reader turns on deliberately, having read the sentence
   * under it, and never something they arrive at by default.
   *
   * What it does NOT do is override any of the gates. An excluded page, a paused
   * site, manual mode and a page that is already an archived copy each stop it —
   * see `Enquiry.mayEnrich` and `@parle/archive`'s `decideLanding`, which is the
   * only thing in the product allowed to say "move this reader".
   */
  readonly autoOpenArchive: boolean
  /**
   * The one source of AI capability that is connected, and its credentials.
   *
   * In this document rather than in one of its own because there is nowhere
   * better: MV3 has no keychain, so a second store would be the same bytes in
   * the same place with an extra file to keep in step. ADR 0004 makes the whole
   * of this an upgrade — a reader who never touches it gets an extension that
   * finds Discussions exactly as well as one who does.
   */
  readonly provider: ProviderSettings
}

/**
 * A first run, before the reader has said anything.
 *
 * Every Network on, because ADR 0005 is "look everything up minus an Exclusion
 * List" and a product whose Networks default to off is a product that shows
 * nothing until you find the settings page. `automatic` is likewise the answer
 * we will offer — but `decided` is false, and that is what actually governs, so
 * the first run of a fresh install issues no Lookup at all until the reader has
 * read the disclosure and chosen. A defaults object cannot make automatic
 * lookups defensible; being asked first is what does.
 */
export const firstRun: ReaderSettings = {
  networks: {
    hackernews: true,
    reddit: true,
    x: true,
    // The three keyless, anonymous ones default on for the same reason Hacker
    // News does: they cost the reader's own connection and nothing else, and
    // the consent gate — not this object — is what stops any of them being
    // asked before the reader has read the disclosure and chosen.
    bluesky: true,
    lemmy: true,
    lobsters: true
  },
  automatic: true,
  decided: false,
  excluded: [],
  allowedAnyway: [],
  paused: [],
  // Off, because the measured default it replaces was `google.com` drawing 148
  // conversations about 148 unrelated events. The rule folds rather than
  // deletes, so a reader who wants them is one click away on the page itself
  // and one switch away for good.
  everyDiscussion: false,
  // Off. The reader has not asked to be moved off the pages they open, and
  // nothing about a fresh install may decide that they have.
  autoOpenArchive: false,
  // Nothing connected, which ADR 0004 makes the ordinary case rather than an
  // unconfigured one. The two credential slots exist so that connecting is one
  // edit rather than a shape change.
  provider: {
    connection: "none",
    byok: { apiKey: Redacted.make(""), baseUrl: "", model: "" },
    codex: { token: Redacted.make(""), model: "" }
  }
}

const Site = Schema.Struct({
  host: Schema.String,
  pathPrefix: Schema.String
})

/**
 * A secret as it comes off disk: a plain string, wrapped on the way in.
 *
 * `Schema.RedactedFromValue` is the whole mechanism — the decoded value can no
 * longer be printed, so the only way a key leaves this module is the one
 * function that deliberately unwraps it.
 */
const Secret = Schema.RedactedFromValue(Schema.String)

const StoredProvider = Schema.Struct({
  connection: Schema.optionalKey(Schema.Literals(["none", "byok", "on-device", "codex"])),
  byok: Schema.optionalKey(Schema.Struct({
    apiKey: Schema.optionalKey(Secret),
    baseUrl: Schema.optionalKey(Schema.String),
    model: Schema.optionalKey(Schema.String)
  })),
  codex: Schema.optionalKey(Schema.Struct({
    token: Schema.optionalKey(Secret),
    model: Schema.optionalKey(Schema.String)
  }))
})

/**
 * The stored document, with every field optional.
 *
 * Optional throughout so a document written by an older or newer build still
 * decodes to the fields it does have. A single required field would mean that
 * adding one in a later release silently discards the exclusions a reader had
 * already added — a data loss with no error, on the one value in the product
 * they were explicitly promised control of.
 */
const Stored = Schema.Struct({
  networks: Schema.optionalKey(Schema.Struct({
    hackernews: Schema.optionalKey(Schema.Boolean),
    reddit: Schema.optionalKey(Schema.Boolean),
    x: Schema.optionalKey(Schema.Boolean),
    bluesky: Schema.optionalKey(Schema.Boolean),
    lemmy: Schema.optionalKey(Schema.Boolean),
    lobsters: Schema.optionalKey(Schema.Boolean)
  })),
  automatic: Schema.optionalKey(Schema.Boolean),
  decided: Schema.optionalKey(Schema.Boolean),
  excluded: Schema.optionalKey(Schema.Array(Site)),
  allowedAnyway: Schema.optionalKey(Schema.Array(Site)),
  paused: Schema.optionalKey(Schema.Array(Schema.String)),
  everyDiscussion: Schema.optionalKey(Schema.Boolean),
  autoOpenArchive: Schema.optionalKey(Schema.Boolean),
  provider: Schema.optionalKey(StoredProvider)
})

const readStored = Schema.decodeUnknownOption(Stored)

/** Fold a decoded document over the defaults, or nothing if it is not one. */
const settled = (raw: unknown): Option.Option<ReaderSettings> => {
  const decoded = readStored(raw)
  if (Option.isNone(decoded)) return Option.none()
  const held = decoded.value
  // A document written by a build that predates the three new Networks carries
  // none of their keys, and what that absence means depends on `decided`. A
  // reader with `decided: true` answered a first-run screen that named two
  // companies; treating the missing keys as ON would start sending every
  // non-skipped address to three more the moment they upgrade, with no screen
  // shown and no sentence read — the first-run contract in `welcomeCopy.ts` is
  // that the names are read BEFORE an address leaves. So for them the missing
  // keys mean OFF until they visit settings and turn a switch on themselves.
  // A document with `decided` false or absent is a reader the consent gate is
  // still holding everything for, so the first-run defaults are honest: the
  // screen they are yet to answer names all of these sites.
  const alreadyAnswered = held.decided === true
  return Option.some({
    networks: {
      hackernews: held.networks?.hackernews ?? firstRun.networks.hackernews,
      reddit: held.networks?.reddit ?? firstRun.networks.reddit,
      x: held.networks?.x ?? firstRun.networks.x,
      bluesky: held.networks?.bluesky ?? (alreadyAnswered ? false : firstRun.networks.bluesky),
      lemmy: held.networks?.lemmy ?? (alreadyAnswered ? false : firstRun.networks.lemmy),
      lobsters: held.networks?.lobsters ?? (alreadyAnswered ? false : firstRun.networks.lobsters)
    },
    automatic: held.automatic ?? firstRun.automatic,
    decided: held.decided ?? firstRun.decided,
    excluded: held.excluded ?? firstRun.excluded,
    allowedAnyway: held.allowedAnyway ?? firstRun.allowedAnyway,
    paused: held.paused ?? firstRun.paused,
    everyDiscussion: held.everyDiscussion ?? firstRun.everyDiscussion,
    // A document written by a build that predates this field carries none, and
    // it falls back to `firstRun` — which is `false`, unconditionally. The same
    // argument the three new Networks made above, one step stronger: a missing
    // Network key at least has a state (`decided` false) in which the
    // permissive default is honest, because the disclosure naming that Network
    // is still ahead of the reader. There is no state in which "start
    // redirecting this reader off the pages they open" is something anyone
    // agreed to without touching this switch.
    autoOpenArchive: held.autoOpenArchive ?? firstRun.autoOpenArchive,
    provider: {
      connection: held.provider?.connection ?? firstRun.provider.connection,
      byok: {
        apiKey: held.provider?.byok?.apiKey ?? firstRun.provider.byok.apiKey,
        baseUrl: held.provider?.byok?.baseUrl ?? firstRun.provider.byok.baseUrl,
        model: held.provider?.byok?.model ?? firstRun.provider.byok.model
      },
      codex: {
        token: held.provider?.codex?.token ?? firstRun.provider.codex.token,
        model: held.provider?.codex?.model ?? firstRun.provider.codex.model
      }
    }
  })
}

/**
 * The document as it goes to disk.
 *
 * Written out field by field rather than handed to `JSON.stringify` whole,
 * because the two secrets are `Redacted` and `JSON.stringify` would faithfully
 * write `"<redacted>"` over the reader's key. That is the redaction working —
 * it is *supposed* to be impossible to serialise a secret by accident — so this
 * is the one place that unwraps, and it says so.
 */
export const asDocument = (settings: ReaderSettings): string =>
  JSON.stringify({
    networks: settings.networks,
    automatic: settings.automatic,
    decided: settings.decided,
    excluded: settings.excluded,
    allowedAnyway: settings.allowedAnyway,
    paused: settings.paused,
    everyDiscussion: settings.everyDiscussion,
    autoOpenArchive: settings.autoOpenArchive,
    provider: {
      connection: settings.provider.connection,
      byok: {
        apiKey: Redacted.value(settings.provider.byok.apiKey),
        baseUrl: settings.provider.byok.baseUrl,
        model: settings.provider.byok.model
      },
      codex: {
        token: Redacted.value(settings.provider.codex.token),
        model: settings.provider.codex.model
      }
    }
  })

/**
 * The document as it comes back, if it can be read at all.
 *
 * `Option.none` for a document that is on disk and unreadable — garbage bytes,
 * or a shape no build of ours ever wrote. The distinction from "no document"
 * matters to exactly one caller: `Settings.current` falls back to the last
 * value it actually read rather than to the defaults, because a corrupt
 * document must never widen what we look up (see the file header), and it must
 * not un-decide the first-run question either.
 */
export const readDocument = (text: string): Option.Option<ReaderSettings> => {
  try {
    return settled(JSON.parse(text))
  } catch {
    return Option.none()
  }
}

/** The document as it comes back, or `firstRun` if it is not one. */
export const fromDocument = (text: string): ReaderSettings =>
  Option.getOrElse(readDocument(text), () => firstRun)

// ---------------------------------------------------------------------------
// The edits, as pure functions
// ---------------------------------------------------------------------------

/**
 * Every change the reader can make, as a value-to-value function.
 *
 * Pure and exported so the options page, the panel's pause affordance and the
 * tests all perform the *same* edit. A per-surface implementation of "add an
 * exclusion" is how one surface ends up storing an unnormalised host that the
 * matcher never fires on.
 */
export const withNetwork = (
  settings: ReaderSettings,
  network: Network,
  on: boolean
): ReaderSettings => ({ ...settings, networks: { ...settings.networks, [network]: on } })

/**
 * The reader's answer about automatic lookups, from wherever they gave it.
 *
 * It sets `decided` as well, and that is the only thing that ever does. Both
 * places the question is asked — the first-run page and the settings page —
 * carry the same disclosure above the switch, so touching the switch at all is
 * evidence the reader was shown it. Turning automatic lookups *off* counts just
 * as much as turning them on: they were asked, and they answered.
 */
export const withAutomatic = (settings: ReaderSettings, on: boolean): ReaderSettings => ({
  ...settings,
  automatic: on,
  decided: true
})

/**
 * Whether to show Discussions on a site's front page too.
 *
 * The one override for the Front Door rule. A separate act from every other
 * switch because it changes what the panel DRAWS rather than where Parle looks:
 * turning it on issues no new Lookup and turning it off cancels none, so it is
 * the one control here that can never cost the reader a request.
 */
export const withEveryDiscussion = (settings: ReaderSettings, on: boolean): ReaderSettings => ({
  ...settings,
  everyDiscussion: on
})

/**
 * Whether to be taken to the Internet Archive's copy instead of the live page.
 *
 * Its own edit rather than a flag folded into another, because it is the only
 * setting in this document that can cause a NAVIGATION. Everything else here
 * changes what Parle asks or what the panel draws; this one moves the reader,
 * and something that moves the reader should be one function, called from one
 * control, with one sentence above it.
 */
export const withAutoOpenArchive = (
  settings: ReaderSettings,
  on: boolean
): ReaderSettings => ({ ...settings, autoOpenArchive: on })

/**
 * Which Provider is active, changed without touching either credential.
 *
 * Switching away from a Provider deliberately does NOT clear its key. A reader
 * trying Chrome's on-device model for an afternoon should not have to paste
 * their API key again afterwards, and a settings page that silently destroyed a
 * credential on a radio-button click would be the worst kind of surprise. The
 * page offers "forget this key" as its own act, because deleting a secret is
 * something a person should have to mean.
 */
export const withProviderConnection = (
  settings: ReaderSettings,
  connection: ProviderConnection
): ReaderSettings => ({ ...settings, provider: { ...settings.provider, connection } })

/**
 * The reader's own key, endpoint and model.
 *
 * Every field is optional so that editing the model does not require handing
 * the key back in — which would mean the options page holding a decrypted
 * secret in a DOM node for as long as the tab is open just to be able to write
 * an unrelated field.
 */
export const withByok = (
  settings: ReaderSettings,
  said: {
    readonly apiKey?: string
    readonly baseUrl?: string
    readonly model?: string
  }
): ReaderSettings => ({
  ...settings,
  provider: {
    ...settings.provider,
    byok: {
      apiKey: said.apiKey === undefined
        ? settings.provider.byok.apiKey
        : Redacted.make(said.apiKey.trim()),
      baseUrl: said.baseUrl === undefined
        ? settings.provider.byok.baseUrl
        : said.baseUrl.trim().replace(/\/+$/, ""),
      model: said.model === undefined ? settings.provider.byok.model : said.model.trim()
    }
  }
})

/** A pasted Codex token, and the model to spend it on. See {@link CodexSettings}. */
export const withCodex = (
  settings: ReaderSettings,
  said: { readonly token?: string; readonly model?: string }
): ReaderSettings => ({
  ...settings,
  provider: {
    ...settings.provider,
    codex: {
      token: said.token === undefined
        ? settings.provider.codex.token
        : Redacted.make(said.token.trim()),
      model: said.model === undefined ? settings.provider.codex.model : said.model.trim()
    }
  }
})

/**
 * Throw a credential away, and stop using the Provider it belonged to.
 *
 * Both halves, always. A key removed while its Provider stays selected leaves
 * the panel reporting "not connected" from a Provider the settings page still
 * shows as chosen, which reads as the extension having lost the key rather than
 * as the reader having removed it.
 */
export const withoutProviderKey = (
  settings: ReaderSettings,
  which: "byok" | "codex"
): ReaderSettings => {
  const cleared: ProviderSettings = which === "byok"
    ? { ...settings.provider, byok: { ...settings.provider.byok, apiKey: Redacted.make("") } }
    : { ...settings.provider, codex: { ...settings.provider.codex, token: Redacted.make("") } }
  return {
    ...settings,
    provider: {
      ...cleared,
      connection: settings.provider.connection === which ? "none" : settings.provider.connection
    }
  }
}

/** Whether a secret has anything in it. The only question anyone may ask of one. */
export const isSet = (secret: Redacted.Redacted<string>): boolean =>
  Redacted.value(secret).trim() !== ""

const samePattern = (a: SitePattern, b: SitePattern): boolean =>
  a.host === b.host && a.pathPrefix === b.pathPrefix

const withPattern = (
  held: ReadonlyArray<SitePattern>,
  pattern: SitePattern
): ReadonlyArray<SitePattern> =>
  held.some((p) => samePattern(p, pattern)) ? held : [...held, pattern]

const withoutPattern = (
  held: ReadonlyArray<SitePattern>,
  pattern: SitePattern
): ReadonlyArray<SitePattern> => held.filter((p) => !samePattern(p, pattern))

export const withExclusion = (
  settings: ReaderSettings,
  pattern: SitePattern
): ReaderSettings => ({
  ...settings,
  excluded: withPattern(settings.excluded, pattern),
  // An address cannot be both excluded by the reader and allowed anyway by
  // them. Dropping the opposite entry keeps the settings page from showing two
  // rows that contradict each other and leaving the reader to guess which won.
  allowedAnyway: withoutPattern(settings.allowedAnyway, pattern)
})

export const withoutExclusion = (
  settings: ReaderSettings,
  pattern: SitePattern
): ReaderSettings => ({ ...settings, excluded: withoutPattern(settings.excluded, pattern) })

export const withAllowAnyway = (
  settings: ReaderSettings,
  pattern: SitePattern
): ReaderSettings => ({
  ...settings,
  allowedAnyway: withPattern(settings.allowedAnyway, pattern),
  excluded: withoutPattern(settings.excluded, pattern)
})

export const withoutAllowAnyway = (
  settings: ReaderSettings,
  pattern: SitePattern
): ReaderSettings => ({
  ...settings,
  allowedAnyway: withoutPattern(settings.allowedAnyway, pattern)
})

export const withPause = (settings: ReaderSettings, host: string): ReaderSettings => {
  const lower = host.toLowerCase()
  return settings.paused.includes(lower)
    ? settings
    : { ...settings, paused: [...settings.paused, lower] }
}

export const withoutPause = (settings: ReaderSettings, host: string): ReaderSettings => {
  const lower = host.toLowerCase()
  return { ...settings, paused: settings.paused.filter((h) => h !== lower) }
}

/**
 * Read what the reader typed into the "add a site" box as a pattern.
 *
 * Deliberately forgiving about the shape of the input and strict about the
 * result: a reader types `docs.example.com/internal`, or pastes a whole URL, or
 * types `https://example.com`. All three mean the same thing, and a settings
 * page that accepts only one of them stores nothing on the other two while
 * looking like it worked.
 *
 * Returns `null` rather than a guess when there is no host to be had, so the
 * page can say so instead of adding an entry that matches nothing.
 */
export const readSite = (typed: string): SitePattern | null => {
  const trimmed = typed.trim()
  if (trimmed === "") return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  // A host with no dot is either an internal name — already covered by the
  // mechanical layer, which is complete by construction — or a typo. Neither is
  // an entry worth storing.
  if (host === "" || !host.includes(".")) return null
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
  return { host, pathPrefix: path }
}

/** How a pattern reads back to the reader. */
export const siteLabel = (pattern: SitePattern): string =>
  pattern.pathPrefix === "" ? pattern.host : `${pattern.host}${pattern.pathPrefix}`

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export class Settings extends Context.Service<Settings, {
  /**
   * The document as it is on disk right now.
   *
   * Never fails, and never widens on failure — see the file header. Read on
   * every policy decision rather than held, which is what makes an edit from
   * the options page take effect in the background without a restart.
   */
  readonly current: Effect.Effect<ReaderSettings>
  /**
   * Apply one edit and persist the result, answering with what is now stored.
   *
   * Read-modify-write against the store rather than against anything held in
   * this layer, so two surfaces editing in the same second do not each write
   * their own stale copy back.
   */
  readonly change: (
    edit: (settings: ReaderSettings) => ReaderSettings
  ) => Effect.Effect<ReaderSettings>
}>()("parle/settings/Settings") {
  static readonly layer: Layer.Layer<Settings, never, Storage> = Layer.effect(
    Settings,
    Effect.gen(function*() {
      const store = yield* Storage
      /** The last document we successfully read. Not a cache — a floor. */
      const lastGood = yield* Ref.make(firstRun)

      const current = Effect.gen(function*() {
        const held = yield* store.get(SETTINGS_KEY).pipe(
          Effect.catch(() => Effect.succeed(Option.none<Uint8Array>()))
        )
        if (Option.isNone(held)) return yield* Ref.get(lastGood)
        // A document that is THERE and unreadable is a storage fault, not a
        // fresh install, and it gets the storage-fault fallback: the last value
        // actually read, never the defaults. Falling to `firstRun` here would
        // both widen the Network switches and flip `decided` back to false —
        // un-asking a question the reader already answered — and it would
        // poison `lastGood` with that answer for the rest of the worker's life.
        const settings = readDocument(asText(held.value))
        if (Option.isNone(settings)) return yield* Ref.get(lastGood)
        yield* Ref.set(lastGood, settings.value)
        return settings.value
      })

      const change = Effect.fn("Settings.change")(function*(
        edit: (settings: ReaderSettings) => ReaderSettings
      ) {
        const next = edit(yield* current)
        // Total on purpose: a full disk must not throw away the edit the reader
        // can see on screen, and the next read falls back to `lastGood`, which
        // this line has already made the value they chose.
        yield* Ref.set(lastGood, next)
        yield* store.set(SETTINGS_KEY, asDocument(next)).pipe(
          Effect.catch(() => Effect.void)
        )
        return next
      })

      return Settings.of({ current, change })
    })
  )
}
