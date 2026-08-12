/**
 * The Front Door sweep: a real Chrome, the real extension, real pages.
 *
 * This is not a unit test with a browser attached. Every address is fetched for
 * real, every Lookup goes to Hacker News' real Algolia endpoint, and what is
 * recorded is what the toolbar surface actually drew. The point is to find out
 * where the rule is WRONG, so the report prints one row per page — expected,
 * actual, verdict — and never summarises a failure away.
 *
 * Four sweeps, in the order a sceptical reader would run them:
 *
 *   1. Links off the Hacker News front page. These are the pages the product is
 *      for, and every one of them that loses its mark is a real regression.
 *   2. Links off Reddit. Reddit itself refuses this network, which is expected —
 *      what matters is that it renders as a refusal and never as "nobody
 *      discussed this".
 *   3. Pages that should show nothing: site front doors, bank logins, docs
 *      roots, pricing pages, section pages.
 *   4. Classics. `paulgraham.com`, `danluu.com`, and the two rootish ones the
 *      rule's margin is thinnest against.
 *
 * The toolbar surface is read rather than the mark, because on a front door with
 * nothing fresh the mark deliberately never appears — so reading the mark alone
 * cannot tell "folded" from "nothing was found", which is exactly the difference
 * under test.
 *
 * The addresses live in `frontdoor.corpus.ts` and everything that decides a
 * verdict lives in `frontdoor.lib.ts` — shared, byte for byte, with the sharded
 * runner (`sweep.e2e.ts`), which runs this same corpus across N harnesses.
 * This entrypoint remains the one-process, one-profile way to run it.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import type { Page } from "playwright"
import type { Browser } from "playwright"
import { asideSurface, launch, SHOTS_PATH, type Surface } from "./harness.ts"
import { CLASSICS, HN_FRONT, OPENERS, QUIET, REDDIT_NETWORK, REDDIT_MARKUP, SHOTS } from "./frontdoor.corpus.ts"
import {
  armAndOpenAside,
  judge,
  judgeRedditNetwork,
  keepLinks,
  printReport,
  rowLine,
  settle,
  visit,
  type Expected,
  type Row
} from "./frontdoor.lib.ts"

const rows: Array<Row> = []

const check = async (aside: Surface, page: Page, url: string, expected: Expected): Promise<Row> => {
  const seen = await visit(aside, page, url)
  const row = judge(url, expected, seen)
  rows.push(row)
  console.log(rowLine(row))
  return row
}

/** Links off a Network's own front page, as a reader would follow them. */
const linksFrom = async (page: Page, address: string, selector: string, want: number) => {
  await page.goto(address, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {})
  await settle(2500)
  const hrefs = await page.$$eval(selector, (nodes) =>
    // SAFETY: the selector matches anchors; $$eval yields Element.
    nodes.map((n) => (n as HTMLAnchorElement).href).filter((h) => h.startsWith("http")))
  return keepLinks(hrefs, want, HN_FRONT.skipHosts)
}

const DEBUG_PORT = 9414

const main = async () => {
  fs.mkdirSync(SHOTS_PATH, { recursive: true })
  const h = await launch({
    debugPort: DEBUG_PORT,
    viewport: null,
    profilePath: path.resolve(SHOTS_PATH, "../.e2e-profile-frontdoor")
  })
  const page = h.context.pages()[0] ?? (await h.context.newPage())
  const remotes: Array<Browser> = []

  const found = await armAndOpenAside(h, page, OPENERS, DEBUG_PORT)
  if (found === null) {
    console.error("could not open the panel beside the page — nothing to read")
    process.exit(1)
  }
  remotes.push(found.remote)
  const aside = asideSurface(found.page)
  console.log(`panel beside the page: ${(await aside.text()).length} chars\n`)

  console.log("\n=== 1. Off the Hacker News front page ===\n")
  const hn = await linksFrom(page, HN_FRONT.address, HN_FRONT.selector, HN_FRONT.want)
  console.log(`(${hn.length} distinct hosts)\n`)
  for (const url of hn) await check(aside, page, url, HN_FRONT.expected)

  console.log("\n=== 2. Reddit ===\n")
  // The Network itself, first. Its refusal is the thing under test.
  const seen = await visit(aside, page, REDDIT_NETWORK)
  const redditRow = judgeRedditNetwork(seen)
  console.log(`  reddit's own account line: ${redditRow.actual}`)
  rows.push(redditRow)
  for (const url of REDDIT_MARKUP) await check(aside, page, url, "shows")

  console.log("\n=== 3. Pages that should show nothing ===\n")
  for (const url of QUIET) await check(aside, page, url, "quiet")

  console.log("\n=== 4. The classics ===\n")
  for (const url of CLASSICS) await check(aside, page, url, "shows")

  // Screenshots of the states the objection is about, as drawn.
  for (const [name, url] of SHOTS) {
    const shot = await visit(aside, page, url)
    await found.page.screenshot({ path: path.join(SHOTS_PATH, `${name}.png`), fullPage: true })
    console.log(`\n--- ${url} ---\n${shot.text}\n`)
    // And again with the fold opened, which is the whole promise.
    if (shot.folded > 0) {
      await aside.click(".parle-act-folded")
      await settle(600)
      await found.page.screenshot({ path: path.join(SHOTS_PATH, `${name}-opened.png`), fullPage: true })
    }
  }

  printReport(rows)
  fs.writeFileSync(path.join(SHOTS_PATH, "frontdoor-sweep.json"), JSON.stringify(rows, null, 2))
  for (const remote of remotes) await remote.close().catch(() => {})
  await h.close()
}

main().catch((error) => {
  console.error("SWEEP FAILED:", error)
  process.exit(1)
})
