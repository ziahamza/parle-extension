/**
 * A throwaway probe: what does the panel actually say on ONE address, first,
 * in a profile that has spent no rate budget at all?
 *
 * Written for the verification pass, to tell two very different things apart on
 * a page the sweep reports as empty:
 *
 *   - the connector genuinely finds nothing (a false negative worth an ADR), or
 *   - the sweep had already spent its per-Network budget by the time it got
 *     there, and the row is an artefact of the sweep's own request volume.
 *
 * The sweep cannot tell these apart, because a Withholding renders as no rows
 * and its "nothing came back to judge" branch fires on row count alone.
 */
import * as path from "node:path"
import { launch, pillPanel, SHOTS_PATH, trustedClick } from "./harness.ts"

const DEBUG_PORT = 9417
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

const TARGETS = process.argv.slice(2)

const main = async () => {
  const h = await launch({
    debugPort: DEBUG_PORT,
    viewport: null,
    profilePath: path.resolve(SHOTS_PATH, "../.e2e-profile-probe")
  })
  const page = h.context.pages()[0] ?? (await h.context.newPage())
  const welcome = await h.context.newPage()
  await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`)
  await welcome.locator("#on").click().catch(() => {})
  await settle(800)
  await welcome.close()

  // Open the panel on a page known to have Discussions, so the surface exists.
  let opened = false
  for (const opener of ["https://paulgraham.com/greatwork.html", "https://grugbrain.dev/"]) {
    await page.bringToFront()
    await page.goto(opener, { waitUntil: "domcontentloaded" }).catch(() => {})
    await settle(8000)
    const pill = await pillPanel(page)
    await trustedClick(page, pill, ".parle-pill")
    await settle(2000)
    if ((await pill.count(".parle-dock")) === 1) {
      opened = true
      break
    }
  }
  if (!opened) {
    console.error("could not open the in-page panel")
    process.exit(1)
  }

  for (const target of TARGETS) {
    await page.bringToFront()
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {})
    await settle(12_000)
    const pill = await pillPanel(page)
    if ((await pill.count(".parle-pill")) > 0 && (await pill.count(".parle-dock")) === 0) {
      await trustedClick(page, pill, ".parle-pill")
      await settle(1500)
    }
    const text = await pill.text()
    const rows = await pill.count(".parle-group-linked .parle-row")
    const folded = await pill.count(".parle-folded-rows .parle-row")
    console.log(`\n===== ${target}`)
    console.log(`rows=${rows} folded=${folded}`)
    console.log("----- panel text -----")
    console.log(text)
  }

  await h.context.close()
}

await main()
