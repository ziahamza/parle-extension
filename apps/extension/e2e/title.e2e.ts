/**
 * The title race, run repeatedly in a real Chrome — P3's regression check.
 *
 * The defect (battle battery, 2026-08-10, §4 P3): the Topical Lookup is keyed
 * on the tab title, `webNavigation.onCommitted` fires before `<title>` parses,
 * and until it does the tab's title is the browser's placeholder — the page's
 * own address. Battery 1 recorded `title: youtube.com/watch?v=dQw4w9WgXcQ&t=42s`
 * reaching Algolia as a search query; battery 2's run happened to win the race
 * and sent the real title. 3 of 5 recorded runs leaked. The wire guard now
 * withholds the placeholder; what THIS file proves, in a browser, is the other
 * half — ADR 0005's "not yet, never not at all":
 *
 *   - N cold visits to a served page whose title arrives at N different
 *     moments around the 400 ms settle window — before it, at it, well after
 *     it — every one ENDS with a real-title topical query on the wire and
 *     ZERO address-shaped ones;
 *   - a page whose title NEVER arrives ends as a rendered `no-title`
 *     Withholding in the toolbar's account — words on a screen, not a hang.
 *
 * Hermetic: the fixture pages, Algolia and Reddit are all served by the
 * harness (`context.route` reaches the MV3 worker's own fetches — measured
 * before the torture suite relied on it), so this run costs the live world
 * nothing and owes the ADR 0014 ledger nothing. The navigation, the worker,
 * the settle window, `tabs.onUpdated`'s title event, the `retitled` relay and
 * the whole Enquiry are real.
 */
import * as path from "node:path"
import { launch, SHOTS_PATH } from "./harness.ts"

interface Check {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}
const checks: Array<Check> = []
const record = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

const until = async (condition: () => boolean | Promise<boolean>, within = 25_000): Promise<boolean> => {
  const deadline = Date.now() + within
  for (;;) {
    if (await condition()) return true
    if (Date.now() > deadline) return false
    await settle(250)
  }
}

/** The host every raced visit lives on. Each visit is its own path = its own Subject. */
const RACE_HOST = "parle-e2e-late-title.com"
/** The page whose title never comes. */
const UNTITLED = "https://parle-e2e-never-titled.com/piece"

/**
 * When each visit's title lands, in ms after the document starts running.
 *
 * Spread deliberately around ReadingWatch's 400 ms settle window so both
 * orders of the race are exercised on every run: 0 is "the title won" (the
 * old passing case), the rest are "the title lost" by growing margins — the
 * 3-in-5 leak, now required to end with a re-fired real-title query instead.
 */
const VISITS = [
  { path: "/race/1", delayMs: 0, title: "Qvbnw Marker One 71001" },
  { path: "/race/2", delayMs: 300, title: "Qvbnw Marker Two 71002" },
  { path: "/race/3", delayMs: 550, title: "Qvbnw Marker Three 71003" },
  { path: "/race/4", delayMs: 900, title: "Qvbnw Marker Four 71004" },
  { path: "/race/5", delayMs: 1500, title: "Qvbnw Marker Five 71005" }
] as const

/** The fixture: a page that declares its title only after `delayMs`. */
const lateTitled = (title: string, delayMs: number): string =>
  `<!doctype html><meta charset="utf-8">` +
  `<style>body{font:16px/1.6 system-ui,sans-serif;padding:48px}</style>` +
  `<h1>A page whose title arrives ${delayMs} ms late</h1>` +
  `<p>Until the script below runs, the tab's title is the browser's placeholder — this page's own address.</p>` +
  (delayMs === 0
    ? `<script>document.title = ${JSON.stringify(title)}</script>`
    : `<script>setTimeout(() => { document.title = ${JSON.stringify(title)} }, ${delayMs})</script>`)

/** A title as Algolia's query string carries it. */
const asQuery = (title: string): string => encodeURIComponent(title).replace(/%20/g, "+")

const main = async () => {
  console.log("\n=== The title race, repeatedly (P3's re-fire) ===\n")
  const h = await launch({ profilePath: path.resolve(SHOTS_PATH, "..", ".e2e-profile-title") })

  /** Every Algolia ask this run produced, worker fetches included. */
  const algolia: Array<string> = []
  h.context.on("request", (r) => {
    if (r.url().includes("hn.algolia.com")) algolia.push(r.url())
  })
  /** Topical asks only — the requests keyed on a title rather than an address. */
  const topical = () => algolia.filter((u) => !u.includes("restrictSearchableAttributes"))

  try {
    // Served world, registered up front (a mid-run route can fail to attach
    // once a page with its own service worker has loaded — kinds runner).
    await h.context.route("https://hn.algolia.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ hits: [], nbHits: 0 })
      }))
    await h.context.route(/https:\/\/([a-z]+\.)?reddit\.com\/.*/, (route) =>
      route.fulfill({ status: 403, contentType: "text/html", body: "<html>blocked</html>" }))
    for (const visit of VISITS) {
      await h.context.route(`https://${RACE_HOST}${visit.path}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: lateTitled(visit.title, visit.delayMs)
        }))
    }
    await h.context.route(UNTITLED, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><meta charset="utf-8"><h1>No title, ever.</h1>` +
          `<p>Some pages never declare one; the account must settle into words, not hang.</p>`
      }))

    // First run: answer the disclosure, or nothing automatic ever fires.
    const welcome = await h.context.newPage()
    await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`)
    await welcome.bringToFront()
    await welcome.locator("#on").click()
    await settle(800)
    await welcome.close()

    const page = h.context.pages()[0] ?? (await h.context.newPage())

    // ---------------------------------------------------- the race, N times
    for (const visit of VISITS) {
      const address = `https://${RACE_HOST}${visit.path}`
      const wanted = asQuery(visit.title)
      console.log(`\nVisit ${visit.path} — title lands at ${visit.delayMs} ms:`)
      await page.bringToFront()
      await page.goto(address, { waitUntil: "domcontentloaded" }).catch(() => {})

      const asked = await until(() => topical().some((u) => u.includes(wanted)))
      record(
        `ends with a topical query on the REAL title (landed ${visit.delayMs} ms in)`,
        asked,
        asked ? "" : `topical asks so far: ${topical().map((u) => u.slice(0, 120)).join(" | ") || "none"}`
      )
      // Let any straggling wrong query surface before the absence is claimed.
      await settle(1200)
      const leaked = topical().filter((u) => u.includes(RACE_HOST) || u.includes(encodeURIComponent(RACE_HOST)))
      record(
        "and NO address-shaped title query ever left",
        leaked.length === 0,
        leaked[0]?.slice(0, 140) ?? ""
      )
      const wanteds = topical().filter((u) => u.includes(wanted))
      record(
        "the real-title query was paid for once, not per correction event",
        wanteds.length === 1,
        `${wanteds.length} topical ask(s) for this title`
      )
    }

    // ------------------------------------- the title that never arrives
    console.log("\nA page whose title never arrives:")
    const before = topical().length
    await page.bringToFront()
    await page.goto(UNTITLED, { waitUntil: "domcontentloaded" }).catch(() => {})
    await settle(6000)
    record(
      "asks by address and never by its non-title",
      algolia.length > 0 && topical().length === before &&
        !topical().some((u) => u.includes("parle-e2e-never-titled")),
      `${topical().length - before} topical ask(s) for it`
    )

    // Rendered, not a hang — measured off the toolbar the browser itself is
    // showing for that tab. `hintOf` writes "Parle — looking…" while any Place
    // is unsettled, so a title that never arrives leaving the tooltip there
    // forever is exactly what a hang would look like; a settled one reads
    // "nothing found" (Hacker News answered by address, and the title was
    // never asked). The exact account words for the Withholding itself —
    // "not asked — still reading the page's title" — are pinned against the
    // same shipped `panelOf` by `src/app/Retitle.test.ts`; a popup opened as
    // a page cannot stand in for the real toolbar popup here, because opened
    // that way it has a tab of its own and correctly describes it.
    await page.bringToFront()
    const hinted = await until(async () => {
      const hint: string = await h.worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        return tab?.id === undefined ? "" : await chrome.action.getTitle({ tabId: tab.id })
      }).catch(() => "")
      return hint.length > 0 && !hint.includes("looking")
    })
    const finalHint: string = await h.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      return tab?.id === undefined ? "" : await chrome.action.getTitle({ tabId: tab.id })
    }).catch(() => "")
    record(
      "the account SETTLES on screen rather than hanging at 'looking…'",
      hinted,
      `the toolbar says: "${finalHint}"`
    )
  } finally {
    await h.close()
  }

  const failed = checks.filter((c) => !c.ok)
  console.log(
    `\n${checks.length - failed.length}/${checks.length} title-race checks passed` +
      ` · algolia route-served in-harness: ${algolia.length} request(s), 0 live\n`
  )
  if (failed.length > 0) process.exit(1)
}

main().catch((e) => {
  console.error("\nHARNESS FAILED:", e)
  process.exit(1)
})
