/**
 * Drawing the settings page, with the DOM and nothing else.
 *
 * Same rule as `render.ts` and for the same reason: no framework, because ADR
 * 0003 makes iOS the constraining platform and the bundle is the thing App
 * Review and a phone both have opinions about. The settings page is not
 * injected into anyone's page, so the argument is weaker here — but shipping a
 * runtime for one screen would put it in the artifact anyway, and the screen is
 * a list of checkboxes.
 *
 * Everything is set through `textContent`. The only third-party strings on this
 * page are hostnames the reader typed and hostnames from the bundled list, and
 * both take the same path as everything else.
 *
 * The page is drawn whole on every change rather than mutated in place. It is a
 * few hundred nodes and it changes when a person clicks something, so a diff
 * buys nothing — and redrawing from the settings that were actually persisted
 * is what makes the screen incapable of showing a state the store does not
 * hold. A checkbox that stays ticked after the write failed is the exact bug
 * that makes a privacy control untrustworthy.
 */
import type { Network } from "@parle/domain/Network"
import type { Category } from "@parle/policy/Exclusion"
import type { SitePattern } from "@parle/policy/ReaderChoices"
import type { DomainArtifact } from "@parle/policy/Seed"
import {
  AUTOMATIC,
  CATEGORY_TITLES,
  DISCLOSURE,
  FOOTER,
  FORGETTING,
  LONGER,
  NETWORKS,
  PROVIDER,
  SKIPPED
} from "./settingsCopy.ts"
import type { ProviderConnection, ReaderSettings } from "../settings/Settings.ts"
import { isSet, siteLabel } from "../settings/Settings.ts"

/** Everything the page can be asked to do. Every one of them persists first. */
export interface SettingsActs {
  readonly setNetwork: (network: Network, on: boolean) => void
  readonly setAutomatic: (on: boolean) => void
  /** Which Provider is active. Never clears the other one's credential. */
  readonly setProvider: (connection: ProviderConnection) => void
  readonly setByok: (
    said: { readonly apiKey?: string; readonly baseUrl?: string; readonly model?: string }
  ) => void
  readonly setCodex: (said: { readonly token?: string; readonly model?: string }) => void
  /** Throw a credential away, on purpose, as its own act. */
  readonly forgetProviderKey: (which: "byok" | "codex") => void
  readonly addExclusion: (typed: string) => void
  readonly removeExclusion: (pattern: SitePattern) => void
  readonly allowAnyway: (typed: string) => void
  readonly removeAllowAnyway: (pattern: SitePattern) => void
  readonly resumeSite: (host: string) => void
  readonly forget: (scope: "everything" | "lookup-record") => void
}

/** What the page shows that is not a setting: the build, and the last message. */
export interface PageState {
  readonly settings: ReaderSettings
  readonly artifact: DomainArtifact
  /** Networks whose request path is not in this build at all (ADR 0001). */
  readonly compiledOut: ReadonlyArray<Network>
  /**
   * Whether this browser actually has a model on it.
   *
   * Probed by the page rather than assumed from the platform, because "Chrome
   * 138 or newer" is not the question — the model is a multi-gigabyte download
   * the reader may never have taken, and Chrome reports `downloadable` for
   * that. Offering a Provider that would silently start a download because
   * somebody opened a settings page is not a choice this page gets to make on
   * their behalf, so `downloadable` counts as absent.
   */
  readonly onDevice: boolean
  /** The one line of feedback from the last thing the reader did. */
  readonly notice: string | null
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] => {
  const made = document.createElement(tag)
  if (className !== "") made.className = className
  if (text !== undefined) made.textContent = text
  return made
}

const button = (className: string, text: string, act: () => void): HTMLButtonElement => {
  const made = el("button", className, text)
  made.type = "button"
  made.addEventListener("click", act)
  return made
}

const section = (title: string): HTMLElement => {
  const made = el("section", "parle-section")
  made.appendChild(el("h2", "parle-section-title", title))
  return made
}

/**
 * A switch with its own sentence under it.
 *
 * The sentence is not a tooltip and is never hidden behind one: a control whose
 * cost you have to hover to discover is a control that was not disclosed.
 */
const toggle = (
  label: string,
  says: string,
  on: boolean,
  enabled: boolean,
  change: (on: boolean) => void
): HTMLElement => {
  const row = el("div", `parle-toggle${enabled ? "" : " parle-toggle-off"}`)
  const line = el("label", "parle-toggle-line")
  const box = document.createElement("input")
  box.type = "checkbox"
  box.checked = on
  box.disabled = !enabled
  box.addEventListener("change", () => change(box.checked))
  line.appendChild(box)
  line.appendChild(el("span", "parle-toggle-label", label))
  row.appendChild(line)
  row.appendChild(el("p", "parle-toggle-says", says))
  return row
}

/** A list of sites the reader can act on, or the sentence saying there are none. */
const siteList = (
  entries: ReadonlyArray<{ readonly label: string; readonly action: string }>,
  empty: string,
  act: (index: number) => void
): HTMLElement => {
  if (entries.length === 0) return el("p", "parle-empty-line", empty)
  const list = el("ul", "parle-sites")
  entries.forEach((entry, index) => {
    const item = el("li", "parle-site")
    item.appendChild(el("span", "parle-site-name", entry.label))
    item.appendChild(button("parle-inline-action", entry.action, () => act(index)))
    list.appendChild(item)
  })
  return list
}

/** A text box, its hint, and the one button that commits it. */
const adder = (
  label: string,
  hint: string,
  action: string,
  commit: (typed: string) => void
): HTMLElement => {
  const wrap = el("div", "parle-adder")
  const field = document.createElement("label")
  field.className = "parle-adder-label"
  field.textContent = label
  const box = document.createElement("input")
  box.type = "text"
  box.className = "parle-adder-box"
  box.placeholder = "example.com"
  field.appendChild(box)
  wrap.appendChild(field)
  wrap.appendChild(el("p", "parle-adder-hint", hint))
  const send = () => {
    const typed = box.value
    box.value = ""
    commit(typed)
  }
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter") send()
  })
  wrap.appendChild(button("parle-action", action, send))
  return wrap
}

const NETWORK_COPY: Record<Network, { readonly name: string; readonly says: string }> = {
  hackernews: NETWORKS.hackernews,
  reddit: NETWORKS.reddit,
  x: NETWORKS.x
}

/**
 * One choice of Provider, with its own sentence, disabled when it cannot work.
 *
 * A radio group rather than a list of switches because exactly one Provider is
 * active — `CONTEXT.md` says so and `@parle/provider` enforces it — and two
 * checkboxes that can both be ticked would be a screen able to describe a state
 * the code cannot be in.
 */
const providerChoice = (
  connection: ProviderConnection,
  name: string,
  says: string,
  chosen: boolean,
  enabled: boolean,
  choose: () => void
): HTMLElement => {
  const row = el("div", `parle-toggle${enabled ? "" : " parle-toggle-off"}`)
  const line = el("label", "parle-toggle-line")
  const box = document.createElement("input")
  box.type = "radio"
  box.name = "parle-provider"
  box.checked = chosen
  box.disabled = !enabled
  box.addEventListener("change", () => {
    if (box.checked) choose()
  })
  line.appendChild(box)
  line.appendChild(el("span", "parle-toggle-label", name))
  row.appendChild(line)
  row.appendChild(el("p", "parle-toggle-says", says))
  return row
}

/**
 * A field for a secret.
 *
 * The box is a password field and starts EMPTY even when a key is saved, and
 * both halves are the point: a settings page that read a stored key back into
 * the DOM would put it in the accessibility tree, in a screenshot, and in
 * whatever a password manager decides to do with a filled field — for as long
 * as the tab is open. What the reader is shown instead is whether one is saved.
 * Replacing it is typing a new one; removing it is its own button.
 */
const secretField = (
  label: string,
  hint: string,
  saved: boolean,
  action: string,
  commit: (typed: string) => void,
  forget: () => void
): HTMLElement => {
  const wrap = el("div", "parle-adder")
  const field = document.createElement("label")
  field.className = "parle-adder-label"
  field.textContent = label
  const box = document.createElement("input")
  box.type = "password"
  box.className = "parle-adder-box"
  box.autocomplete = "off"
  box.placeholder = saved ? "A key is saved. Type a new one to replace it." : ""
  field.appendChild(box)
  wrap.appendChild(field)
  wrap.appendChild(el("p", "parle-adder-hint", hint))
  const send = () => {
    const typed = box.value
    box.value = ""
    commit(typed)
  }
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter") send()
  })
  wrap.appendChild(button("parle-action", action, send))
  if (saved) wrap.appendChild(button("parle-inline-action", PROVIDER.forget, forget))
  return wrap
}

/** A plain text field whose value is not a secret and is shown as it is. */
const plainField = (
  label: string,
  hint: string,
  value: string,
  placeholder: string,
  commit: (typed: string) => void
): HTMLElement => {
  const wrap = el("div", "parle-adder")
  const field = document.createElement("label")
  field.className = "parle-adder-label"
  field.textContent = label
  const box = document.createElement("input")
  box.type = "text"
  box.className = "parle-adder-box"
  box.value = value
  box.placeholder = placeholder
  field.appendChild(box)
  wrap.appendChild(field)
  wrap.appendChild(el("p", "parle-adder-hint", hint))
  const send = () => commit(box.value)
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter") send()
  })
  box.addEventListener("change", send)
  return wrap
}

/**
 * The built-in list, grouped by why each entry is on it.
 *
 * Grouped rather than alphabetical because the reader's question is never "is
 * `monzo.com` here" — they cannot enumerate what they bank with any better than
 * we can. It is "what kinds of thing does this cover", and the answer to that
 * is what tells them what it is missing.
 */
const builtInList = (artifact: DomainArtifact): HTMLElement => {
  const grouped = new Map<Category, Array<string>>()
  for (const entry of artifact.entries) {
    const held = grouped.get(entry.category)
    if (held === undefined) grouped.set(entry.category, [entry.domain])
    else held.push(entry.domain)
  }

  const details = el("details", "parle-built-in")
  const opener = document.createElement("summary")
  opener.textContent = `${SKIPPED.builtIn.title} — ${artifact.entries.length} sites`
  details.appendChild(opener)
  details.appendChild(el("p", "parle-says", SKIPPED.builtIn.says))

  for (const [category, domains] of grouped) {
    const group = el("div", "parle-category")
    group.appendChild(el("h4", "parle-category-title", CATEGORY_TITLES[category]))
    group.appendChild(el("p", "parle-category-domains", domains.join(", ")))
    details.appendChild(group)
  }
  return details
}

/**
 * The long version of the disclosure, behind one click.
 *
 * The first-run screen was cut from ~410 words to under a hundred, and this is
 * where the rest of it went: the three claims this project measured and refuses
 * to make, and the facts about this particular artifact. `<details>` rather than
 * another page because the reader arriving from that screen's "the long version"
 * link lands here, and a second hop to find it would be a third place to keep in
 * step. Closed by default; every word in it is still in the DOM, still greppable,
 * and still one keystroke from find-in-page.
 */
const longerNode = (): HTMLElement => {
  const details = el("details", "parle-longer")
  details.id = "longer"
  const opener = document.createElement("summary")
  opener.textContent = LONGER.title
  details.appendChild(opener)

  for (const part of [LONGER.refuses, LONGER.build]) {
    details.appendChild(el("h3", "parle-sub-title", part.title))
    const list = el("ul", "parle-plain")
    for (const item of part.items) list.appendChild(el("li", "parle-plain-item", item))
    details.appendChild(list)
  }
  return details
}

/** Draw the whole page into `root`, replacing whatever was there. */
export const renderSettings = (
  root: HTMLElement,
  state: PageState,
  acts: SettingsActs
): void => {
  root.textContent = ""
  root.className = "parle-settings"

  // ---------------------------------------------------------------- disclosure
  const disclosure = el("header", "parle-disclosure")
  disclosure.appendChild(el("h1", "parle-title", DISCLOSURE.title))
  for (const paragraph of DISCLOSURE.paragraphs) {
    disclosure.appendChild(el("p", "parle-says", paragraph))
  }
  // Immediately under the standing claim, because it corrects it: the paragraphs
  // name all three sites and this build cannot contact one of them.
  const build = DISCLOSURE.build(
    state.compiledOut.map((network) => NETWORK_COPY[network].name),
    (["hackernews", "reddit", "x"] as const)
      .filter((network) => !state.compiledOut.includes(network))
      .map((network) => NETWORK_COPY[network].name)
  )
  if (build !== null) disclosure.appendChild(el("p", "parle-says parle-honest", build))
  // The detail the first-run screen no longer carries, one click away rather
  // than gone. `settingsCopy.LONGER` says why it is here and not there.
  disclosure.appendChild(longerNode())
  root.appendChild(disclosure)

  if (state.notice !== null) {
    root.appendChild(el("div", "parle-notice-line", state.notice))
  }

  // ----------------------------------------------------------------- automatic
  const automatic = section(AUTOMATIC.title)
  automatic.appendChild(
    toggle(
      AUTOMATIC.label,
      state.settings.automatic ? AUTOMATIC.on : AUTOMATIC.off,
      state.settings.automatic,
      true,
      (on) => acts.setAutomatic(on)
    )
  )
  root.appendChild(automatic)

  // ------------------------------------------------------------------ networks
  const networks = section(NETWORKS.title)
  networks.appendChild(el("p", "parle-says", NETWORKS.intro))
  for (const network of ["hackernews", "reddit", "x"] as const) {
    const copy = NETWORK_COPY[network]
    const absent = state.compiledOut.includes(network)
    networks.appendChild(
      toggle(
        copy.name,
        absent ? `${copy.says} ${NETWORKS.compiledOut}` : copy.says,
        state.settings.networks[network] && !absent,
        !absent,
        (on) => acts.setNetwork(network, on)
      )
    )
  }
  root.appendChild(networks)

  // ------------------------------------------------------------------ provider
  const provider = section(PROVIDER.title)
  provider.appendChild(el("p", "parle-says", PROVIDER.intro))
  // Above the controls, not below them. What a summary costs — comments read
  // and sent onward — is what the reader is deciding about, so it is on screen
  // before the first radio button rather than after the last.
  provider.appendChild(el("p", "parle-says parle-honest", PROVIDER.cost))
  provider.appendChild(el("h3", "parle-sub-title", PROVIDER.choose))

  const chosen = state.settings.provider.connection
  provider.appendChild(
    providerChoice(
      "none",
      PROVIDER.none.name,
      PROVIDER.none.says,
      chosen === "none",
      true,
      () => acts.setProvider("none")
    )
  )
  provider.appendChild(
    providerChoice(
      "byok",
      PROVIDER.byok.name,
      PROVIDER.byok.says,
      chosen === "byok",
      true,
      () => acts.setProvider("byok")
    )
  )
  provider.appendChild(
    providerChoice(
      "on-device",
      PROVIDER.onDevice.name,
      state.onDevice
        ? `${PROVIDER.onDevice.says} ${PROVIDER.onDevice.present}`
        : `${PROVIDER.onDevice.says} ${PROVIDER.onDevice.absent}`,
      chosen === "on-device",
      state.onDevice,
      () => acts.setProvider("on-device")
    )
  )
  provider.appendChild(
    providerChoice(
      "codex",
      PROVIDER.codex.name,
      PROVIDER.codex.says,
      chosen === "codex",
      true,
      () => acts.setProvider("codex")
    )
  )

  // The sentence about where the key lives, once, immediately above the fields
  // that ask for one. See `settingsCopy.ts`: it is the claim this project is
  // not allowed to soften, so it is not tucked into a hint or a tooltip.
  provider.appendChild(el("p", "parle-says parle-honest", PROVIDER.stored))

  provider.appendChild(
    secretField(
      PROVIDER.byok.key,
      PROVIDER.byok.keyHint,
      isSet(state.settings.provider.byok.apiKey),
      PROVIDER.byok.keySave,
      (typed) => acts.setByok({ apiKey: typed }),
      () => acts.forgetProviderKey("byok")
    )
  )
  provider.appendChild(
    plainField(
      PROVIDER.byok.baseUrl,
      PROVIDER.byok.baseUrlHint,
      state.settings.provider.byok.baseUrl,
      "https://api.openai.com/v1",
      (typed) => acts.setByok({ baseUrl: typed })
    )
  )
  provider.appendChild(
    plainField(
      PROVIDER.byok.model,
      PROVIDER.byok.modelHint,
      state.settings.provider.byok.model,
      "gpt-4o-mini",
      (typed) => acts.setByok({ model: typed })
    )
  )

  provider.appendChild(
    secretField(
      PROVIDER.codex.token,
      PROVIDER.codex.tokenHint,
      isSet(state.settings.provider.codex.token),
      PROVIDER.codex.tokenSave,
      (typed) => acts.setCodex({ token: typed }),
      () => acts.forgetProviderKey("codex")
    )
  )
  root.appendChild(provider)

  // ------------------------------------------------------------------- skipped
  const skipped = section(SKIPPED.title)
  skipped.appendChild(el("p", "parle-says parle-honest", SKIPPED.incomplete))

  const rules = el("div", "parle-rules")
  rules.appendChild(el("h3", "parle-sub-title", SKIPPED.rules.title))
  rules.appendChild(el("p", "parle-says", SKIPPED.rules.says))
  // Second paragraph, and it is the honest half: the shape rules are the ones
  // that can miss, and the reader is told so where they are described.
  rules.appendChild(el("p", "parle-says parle-honest", SKIPPED.rules.shapes))
  skipped.appendChild(rules)

  skipped.appendChild(builtInList(state.artifact))

  skipped.appendChild(el("h3", "parle-sub-title", SKIPPED.yours.title))
  skipped.appendChild(
    siteList(
      state.settings.excluded.map((pattern) => ({
        label: siteLabel(pattern),
        action: SKIPPED.remove
      })),
      SKIPPED.yours.empty,
      (index) => {
        const pattern = state.settings.excluded[index]
        if (pattern !== undefined) acts.removeExclusion(pattern)
      }
    )
  )
  skipped.appendChild(
    adder(SKIPPED.add.label, SKIPPED.add.hint, SKIPPED.add.action, (typed) =>
      acts.addExclusion(typed))
  )

  skipped.appendChild(el("h3", "parle-sub-title", SKIPPED.overridden.title))
  skipped.appendChild(el("p", "parle-says", SKIPPED.overridden.says))
  skipped.appendChild(
    siteList(
      state.settings.allowedAnyway.map((pattern) => ({
        label: siteLabel(pattern),
        action: SKIPPED.remove
      })),
      SKIPPED.overridden.empty,
      (index) => {
        const pattern = state.settings.allowedAnyway[index]
        if (pattern !== undefined) acts.removeAllowAnyway(pattern)
      }
    )
  )
  skipped.appendChild(
    adder(SKIPPED.allow.label, SKIPPED.allow.hint, SKIPPED.allow.action, (typed) =>
      acts.allowAnyway(typed))
  )

  skipped.appendChild(el("h3", "parle-sub-title", SKIPPED.paused.title))
  skipped.appendChild(el("p", "parle-says", SKIPPED.paused.says))
  skipped.appendChild(
    siteList(
      state.settings.paused.map((host) => ({ label: host, action: SKIPPED.resume })),
      SKIPPED.paused.empty,
      (index) => {
        const host = state.settings.paused[index]
        if (host !== undefined) acts.resumeSite(host)
      }
    )
  )
  root.appendChild(skipped)

  // ---------------------------------------------------------------- forgetting
  const forgetting = section(FORGETTING.title)
  const everything = el("div", "parle-forget")
  everything.appendChild(el("p", "parle-says", FORGETTING.everything.says))
  everything.appendChild(
    button("parle-action parle-action-loud", FORGETTING.everything.action, () =>
      acts.forget("everything"))
  )
  forgetting.appendChild(everything)

  const finer = el("div", "parle-forget")
  finer.appendChild(el("p", "parle-says", FORGETTING.lookupRecord.says))
  finer.appendChild(
    button("parle-action", FORGETTING.lookupRecord.action, () => acts.forget("lookup-record"))
  )
  forgetting.appendChild(finer)
  forgetting.appendChild(el("p", "parle-says parle-quiet", FORGETTING.kept))
  root.appendChild(forgetting)

  // -------------------------------------------------------------------- footer
  const footer = el("footer", "parle-foot")
  footer.appendChild(el("p", "parle-quiet", FOOTER.version(state.artifact.version)))
  footer.appendChild(el("p", "parle-quiet", FOOTER.source))
  root.appendChild(footer)
}
