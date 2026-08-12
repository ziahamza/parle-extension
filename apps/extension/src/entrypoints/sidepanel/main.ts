/**
 * The surface beside the page: the Discussions, read in parallel with the
 * article rather than on top of it.
 *
 * This is the third container for one renderer, and the point of the exercise
 * is how little of it there is. It mounts a node, opens the same wire the pill
 * and the popup open, and hands whole `Panel`s to the same drawing code. There
 * is no state here, no fetching, no branching on which browser this is — the
 * browsers that have no such panel simply never build a document for it, and
 * `pill.content.ts` goes on being their whole product.
 *
 * ## What is genuinely different about this container
 *
 * **It outlives everything.** The mark's surface is about the page it is on and
 * dies with it, which `pill.content.ts` argues for at length and which is
 * right. This one is browser chrome: measured on Chrome 151, its document
 * survives a tab switch and a navigation without being reloaded, and it is told
 * nothing when either happens. Two consequences, and both are handled elsewhere
 * rather than here — which is what makes this file short:
 *
 *   - It has to FOLLOW the reader. `Watch(null)` means "whatever tab the reader
 *     is looking at" and now keeps meaning it, rather than resolving once; see
 *     `background.ts`'s `follow`.
 *   - It cannot vanish on a page with nothing, the way the mark does. So
 *     `renderAside` swaps in the account of every Place we turned to, which is
 *     ADR 0011's degraded states in the container the reader already has open.
 *
 * **It survives the worker.** MV3 kills the background out from under an open
 * panel. `Surface.link` already reconnects and replays its standing Ask, and
 * because the background sends whole state rather than deltas the first frame
 * after a reconnect is simply correct. Measured against a forcibly killed
 * worker with this exact arrangement: the document is untouched, the port
 * disconnects, the reconnect wakes a new worker with empty memory, and the
 * next frame is right. Nothing in this file had to know.
 */
import { link } from "../../platform/Surface.ts"
import type { Panel } from "../../view/Panel.ts"
import type { Acts } from "../../view/render.ts"
import { renderAside } from "../../view/render.ts"
import { PANEL_STYLES } from "../../view/styles.ts"
import {
  ASIDE_PORT,
  AsideVisible,
  Decide,
  LookAnyway,
  OpenDisclosure,
  OpenOut,
  OpenSettings,
  PauseSite,
  ResumeSite,
  ReadDiscussion,
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
    renderAside(root, standing, acts)
  }

  const wire = link(ASIDE_PORT, (word) => {
    if (word._tag !== "Standing") return
    standing = word.panel
    draw()
  })

  const reportVisibility = (): void => {
    // Standing: replay the current state if MV3 kills and restarts the worker
    // while Chrome keeps this side-panel document alive.
    wire.say(AsideVisible(!document.hidden), true)
  }
  document.addEventListener("visibilitychange", reportVisibility)
  reportVisibility()

  const acts: Acts = {
    openOut: (address) => wire.say(OpenOut(address)),
    lookAnyway: () => wire.say(LookAnyway()),
    summarise: () => wire.say(Summarise()),
    readDiscussion: (key) => wire.say(ReadDiscussion(key)),
    decide: (automatic) => wire.say(Decide(automatic)),
    openDisclosure: () => wire.say(OpenDisclosure()),
    openSettings: () => wire.say(OpenSettings()),
    pauseSite: (host) => wire.say(PauseSite(host)),
    resumeSite: (host) => wire.say(ResumeSite(host))
  }

  root.textContent = "Looking…"
  // Standing, so it is replayed when MV3 kills the worker under an open panel.
  wire.say(Watch(null), true)
}
