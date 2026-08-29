/**
 * The first-run page: the one question, and the state of its answer.
 *
 * It is a page rather than a banner over the panel because a banner sits over a
 * decision already taken. Nothing automatic runs until this is answered —
 * `Choices.choicesOf` reports manual mode while `decided` is false — so the two
 * buttons below are the whole of what turns this extension on, and a reader who
 * closes this tab without touching either gets an extension that looks nothing
 * up and says so on every page.
 *
 * The prose is in `view/welcomeCopy.ts` rather than inline here or in
 * `index.html`, and that is the same decision `settingsCopy.ts` records: this
 * copy is the disclosure Chrome's Limited Use policy requires in the product's
 * interface, so it lives where it can be read, reviewed and diffed as prose
 * without reading DOM code — and where the five-term vocabulary rule is
 * checkable by eye. `settingsView.test.ts` reads that module directly.
 *
 * Two sentences are assembled here rather than written out, and only two: which
 * sites this build actually contacts, and which it cannot. ADR 0001 compiles X
 * out of this artifact, and a first-run screen naming a service the code cannot
 * reach is checkably wrong about the one thing it is easiest to check.
 *
 * It reads *state*, exactly like the panel: the background sends the current
 * decision and every subsequent one, so a second copy of this page, or the
 * settings page changing the same switch, cannot leave the two disagreeing.
 */
import { link } from "../../platform/Surface.ts"
import type { Decision } from "../../reading/Surroundings.ts"
import { FIRST_RUN } from "../../view/welcomeCopy.ts"
import { Decide, DISCLOSURE_PORT } from "../../wire/Wire.ts"

/** Where the settings page lands in the built artifact. See `background.ts`. */
const SETTINGS_PAGE = "./options.html"

/**
 * ADR 0001's compile-out flag, read the way `@parle/networks/X` reads it.
 *
 * Deliberately NOT imported from `src/policy/Controls.ts`, which re-exports the
 * same literal: that module pulls in `@parle/policy` and Effect, and this is the
 * page a reader sees the instant the extension installs. Importing a boolean
 * through it put 153 kB in front of ninety words. The `define` in `wxt.config.ts`
 * folds this to a literal, so the branch below disappears from the artifact.
 */
declare const __PARLE_X__: boolean | undefined
const X_COMPILED_IN = typeof __PARLE_X__ === "boolean" ? __PARLE_X__ : false

const ASKED: ReadonlyArray<string> = X_COMPILED_IN
  ? ["Hacker News", "Reddit", "X", "Bluesky", "Lemmy", "Lobsters"]
  : ["Hacker News", "Reddit", "Bluesky", "Lemmy", "Lobsters"]
const ABSENT: ReadonlyArray<string> = X_COMPILED_IN ? [] : ["X"]

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

const root = document.getElementById("first-run")

if (root !== null) {
  root.appendChild(el("h1", "", FIRST_RUN.title))
  // The one sentence that has to land before an address leaves the browser, so
  // it is the one sentence set larger than the rest.
  root.appendChild(el("p", "lede", FIRST_RUN.sends(ASKED)))
  root.appendChild(el("p", "", FIRST_RUN.context))
  root.appendChild(el("p", "", FIRST_RUN.skips))
  const absent = FIRST_RUN.absent(ABSENT)
  if (absent !== null) root.appendChild(el("p", "quiet", absent))

  const choice = el("section", "choice")
  choice.appendChild(el("h2", "", FIRST_RUN.ask))
  const buttons = el("div", "buttons")
  const on = el("button", "", FIRST_RUN.on)
  on.type = "button"
  on.id = "on"
  const off = el("button", "", FIRST_RUN.off)
  off.type = "button"
  off.id = "off"
  buttons.appendChild(on)
  buttons.appendChild(off)
  choice.appendChild(buttons)
  const said = el("p", "said", FIRST_RUN.said.undecided)
  said.id = "said"
  choice.appendChild(said)
  root.appendChild(choice)

  const foot = el("footer", "")
  const more = el("a", "", FIRST_RUN.more)
  more.href = SETTINGS_PAGE
  foot.appendChild(more)
  root.appendChild(foot)

  const draw = (decision: Decision): void => {
    // `automatic` is derived from the same list `sends` was drawn from above,
    // so the two sentences on this screen cannot name different sites.
    said.textContent = decision === "automatic"
      ? FIRST_RUN.said.automatic(ASKED)
      : FIRST_RUN.said[decision]
    on.classList.toggle("chosen", decision === "automatic")
    off.classList.toggle("chosen", decision === "manual")
  }

  const wire = link(DISCLOSURE_PORT, (word) => {
    if (word._tag !== "Told") return
    draw(word.decision)
  })

  on.addEventListener("click", () => wire.say(Decide(true)))
  off.addEventListener("click", () => wire.say(Decide(false)))
}
