/**
 * The one thing q2 could not do: READ the side panel document.
 *
 * Same trap as locally, and documented in `harness.ts`: Playwright does not
 * adopt a target that appeared after the client connected. The local harness
 * works around it by connecting a SECOND CDP client after the panel is open
 * (`asideDocument`). Steel exposes exactly one CDP endpoint, so this checks
 * whether the same trick works there — connect fresh, now, against a browser
 * whose panel q2 already opened.
 *
 * Run immediately after `q2-extension.mjs`, against the same live session.
 */
import { chromium } from "playwright"
import { cdpWebSocket, record, tally } from "./lib/steel.mjs"

const browser = await chromium.connectOverCDP(await cdpWebSocket())
const pages = browser.contexts().flatMap((c) => c.pages())
console.log("adopted pages:")
for (const p of pages) console.log(`  ${p.url()}`)

const panel = pages.find((p) => p.url().endsWith("sidepanel.html"))
record(
  "a SECOND CDP client adopts the side panel document (the harness's own workaround)",
  panel !== undefined,
  panel?.url() ?? "not adopted"
)

if (panel !== undefined) {
  const rows = await panel.locator(".parle-row").count().catch(() => -1)
  const text = await panel.innerText(".parle").catch(() => "")
  record("the panel has drawn the discussions it found", rows > 0, `${rows} row(s)`)
  console.log("\npanel text (first 400 chars):")
  console.log(text.slice(0, 400))
}

await browser.close()
process.exit(tally() === 0 ? 0 : 1)
