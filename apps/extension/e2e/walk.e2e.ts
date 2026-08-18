/**
 * A browsing session, photographed — for a person to look at.
 *
 * Every other runner in this directory asserts. It states what it expects and
 * goes red when the browser disagrees, which is the only way to catch a
 * regression and is completely blind to the class of problem that matters most
 * here: the panel is technically correct and reads badly, the mark is where it
 * should be and looks wrong, a page shows Discussions it has no business
 * showing. Nothing in `parle.e2e.ts` can fail for any of those, because nobody
 * knew to assert them.
 *
 * So this one asserts almost nothing. It walks a real reader's afternoon — the
 * Hacker News front page, an article off it, a classic essay, a bank, a site's
 * front door, a paywall, an SPA, the settings — and photographs each step at
 * full size with the panel open where a reader would have it open. The output
 * is a directory of frames and one index, meant to be READ by eye.
 *
 * The judgement is the deliverable. There is no pass or fail here.
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { hasNativeAside, launch, openOptions, pillPanel, SHOTS_PATH, trustedClick } from "./harness.ts"

const OUT = path.join(SHOTS_PATH, "walk")
const DEBUG_PORT = 9455

interface Step {
  readonly name: string
  readonly address: string
  /** What a reader would reasonably expect. Recorded for the eye, not asserted. */
  readonly expect: string
  /** Open the panel on this one, as a reader would when the mark appears. */
  readonly openPanel?: boolean
}

const WALK: ReadonlyArray<Step> = [
  {
    name: "01-hn-front",
    address: "https://news.ycombinator.com/",
    expect: "The reader's own Network. Harvest runs; the page itself should not make a scene."
  },
  {
    name: "02-article-discussed",
    address: "https://www.nature.com/articles/d41586-024-02012-5",
    expect: "Mark (stacked Network discs, draggable) with a count. Panel: linked Discussions with Network-native tabs, tiers visibly apart.",
    openPanel: true
  },
  {
    name: "03-classic-essay",
    address: "https://paulgraham.com/greatwork.html",
    expect: "A classic. Many Discussions over many years, all shown — never folded.",
    openPanel: true
  },
  {
    name: "04-front-door-github",
    address: "https://github.com/",
    expect: "A site's front door. Old Discussions folded behind a stated reason, not deleted.",
    openPanel: true
  },
  {
    name: "05-bank",
    address: "https://www.bankofamerica.com/",
    expect: "Exclusion List. NOTHING should have been asked about this address, and the panel should say so plainly."
  },
  {
    name: "06-paywall",
    address: "https://www.nytimes.com/2024/07/19/business/crowdstrike-outage.html",
    expect: "Looked up like any page. We never read the page's content.",
    openPanel: true
  },
  {
    name: "07-undiscussed",
    address: "https://example.com/",
    expect: "Nobody has discussed it. The panel must distinguish 'we looked and found nothing' from 'we did not look'.",
    openPanel: true
  },
  {
    name: "08-wikipedia-root",
    address: "https://en.wikipedia.org/",
    expect: "Redirects to /wiki/Main_Page. The fold should still fire, via the pre-redirect address."
  }
]

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

const run = async () => {
  await fs.mkdir(OUT, { recursive: true })
  const h = await launch({ debugPort: DEBUG_PORT, viewport: null })
  const notes: Array<string> = []

  // Answer the first-run question the way a reader would, so the walk is of a
  // consenting reader's browser rather than of the disclosure screen.
  const welcome = h.context.pages()[0] ?? await h.context.newPage()
  await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`).catch(() => {})
  await settle(600)
  await welcome.screenshot({ path: path.join(OUT, "00-first-run.png") }).catch(() => {})
  const consent = welcome.getByText("Look pages up automatically", { exact: false }).first()
  if (await consent.count() === 0) throw new Error("first-run consent button not found — the copy moved")
  await consent.click()
  await settle(800)
  await welcome.screenshot({ path: path.join(OUT, "00-first-run-answered.png") }).catch(() => {})

  const page = await h.context.newPage()
  notes.push(`native side panel available: ${await hasNativeAside(h)}`)

  for (const step of WALK) {
    await page.bringToFront()
    await page.goto(step.address, { waitUntil: "domcontentloaded" }).catch(() => {})
    // Long enough that the Lookups have really come back, not just started.
    await settle(5000)
    await page.screenshot({ path: path.join(OUT, `${step.name}-page.png`) }).catch(() => {})

    if (step.openPanel === true) {
      const pill = await pillPanel(page)
      const opened = await trustedClick(page, pill, ".parle-pill").catch(() => false)
      await settle(3500)
      const docked = (await pill.count(".parle-dock")) === 1
      if (docked) {
        await page.screenshot({ path: path.join(OUT, `${step.name}-panel.png`) }).catch(() => {})
        await pill.click(".parle-open")
        await settle(4000)
        await page.screenshot({ path: path.join(OUT, `${step.name}-read.png`) }).catch(() => {})
      }
      await page.screenshot({ path: path.join(OUT, `${step.name}-beside.png`) }).catch(() => {})
      notes.push(`${step.name}: mark clicked=${opened}, dock open=${docked}`)
    }
    notes.push(`${step.name} <${step.address}> — ${step.expect}`)
  }

  const options = await openOptions(h)
  await settle(1500)
  await options.screenshot({ path: path.join(OUT, "09-settings.png"), fullPage: true }).catch(() => {})

  await fs.writeFile(path.join(OUT, "index.txt"), notes.join("\n"), "utf8")
  console.log(notes.join("\n"))
  console.log(`\nframes in ${OUT}`)
  await h.close()
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
