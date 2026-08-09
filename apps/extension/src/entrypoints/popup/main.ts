/**
 * The toolbar surface: where the reader learns what happened, and why.
 *
 * This is the account of every place Parle asked, and it is the one surface
 * that is reachable on every page — the mark in the corner appears only where
 * there is something to read, and most pages have nothing. So ADR 0011's
 * degraded states live here: refused, rate-limited, unreadable, deliberately
 * not asked, and the reason for each. `renderStatus` draws all of them, and
 * there is no arrangement of a Panel in which it draws nothing.
 *
 * It subscribes to *state* and asks for nothing else. There is no "fetch the
 * results" call here and nowhere for one to go: it says which tab it is
 * interested in and receives whole Panels until it closes. Opened before the
 * Enquiry starts, three seconds in, or long after it settles, it runs the same
 * code and shows the truth at that moment — including "still looking" and
 * "Reddit is rate-limiting us", which are frames like any other rather than
 * error paths.
 */
import { link } from "../../platform/Surface.ts"
import type { Panel } from "../../view/Panel.ts"
import type { Acts } from "../../view/render.ts"
import { renderStatus } from "../../view/render.ts"
import { PANEL_STYLES } from "../../view/styles.ts"
import {
  Decide,
  LookAnyway,
  OpenDisclosure,
  OpenOut,
  OpenSettings,
  PANEL_PORT,
  PauseSite,
  ResumeSite,
  Summarise,
  Watch
} from "../../wire/Wire.ts"

const style = document.createElement("style")
style.textContent = PANEL_STYLES
document.head.appendChild(style)

const root = document.getElementById("panel")

if (root !== null) {
  let standing: Panel | null = null

  const draw = (): void => {
    if (standing === null) return
    renderStatus(root, standing, acts)
  }

  const wire = link(PANEL_PORT, (word) => {
    // The wire carries more than one kind of word now; a surface that
    // assumed otherwise would read a field that is not there.
    if (word._tag !== "Standing") return
    standing = word.panel
    draw()
  })

  const acts: Acts = {
    openOut: (address) => wire.say(OpenOut(address)),
    lookAnyway: () => wire.say(LookAnyway()),
    summarise: () => wire.say(Summarise()),
    decide: (automatic) => wire.say(Decide(automatic)),
    openDisclosure: () => wire.say(OpenDisclosure()),
    openSettings: () => wire.say(OpenSettings()),
    pauseSite: (host) => wire.say(PauseSite(host)),
    resumeSite: (host) => wire.say(ResumeSite(host))
  }

  root.textContent = "Looking…"
  wire.say(Watch(null), true)
}
