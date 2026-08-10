/**
 * F1's regression: the ADR 0019 root-fold must survive a SLOW server redirect.
 *
 * The battle battery (BATTLE.md §4, 2026-08-10) caught the fold flickering:
 * `en.wikipedia.org/` → `/wiki/Main_Page` folded 11 in both of battery 1's
 * visits and drew 11 unfolded in both of battery 2's. The mechanism: a server
 * redirect is exactly two events — `onBeforeNavigate` at the origin, a commit
 * at the destination, which never gets an `intended` of its own — so the gap
 * between the two hops in `ReadingWatch`'s chain is the WHOLE network
 * round-trip, and the old traversed filter kept the origin Alias only when
 * DNS + TLS + the 301 all fit inside the 400 ms settle window. The fold's
 * fate was decided by the network weather.
 *
 * So this check is the wikipedia SHAPE with the weather pinned adversarial:
 * a served root whose 301 is deliberately held open LONGER than the settle
 * window, a served destination, and a served Hacker News whose eleven old,
 * disagreeing submissions are exactly what the front-door rule folds. Ten
 * visits, each on a cold profile (fresh disk, fresh worker, first-run answered
 * again), and every one of the ten must fold. Against the pre-fix code this
 * fails 10 of 10, which is the point: the flake is made deterministic here so
 * it can never quietly return as "live-world noise".
 *
 * **No request leaves this machine** — Algolia and Reddit are route-served
 * (`context.route` demonstrably intercepts the MV3 worker's fetch; measured
 * for the torture suite before either file relied on it), and the pages come
 * from a REAL local HTTP server reached through `--host-resolver-rules`, so no
 * politeness gate is owed and the run is deterministic by construction.
 *
 * The pages are NOT `route.fulfill`ed, and that is measured, not stylistic: a
 * Playwright-fulfilled 301 is not a server redirect. The browser's follow-up
 * request escapes interception (it died with `ERR_NAME_NOT_RESOLVED` on the
 * fake host), and the destination then loads as a SECOND navigation with its
 * own `onBeforeNavigate` — the client-redirect event shape, which the chain
 * logic rightly treats differently. Only a real server answering a real
 * socket produces the one-`onBeforeNavigate`-then-commit shape this defect
 * lives in. (This also bounds what BATTLE.md §4's P1 caveat — "proven with
 * Playwright-fulfilled 302s" — actually proved: fulfilled chains exercise the
 * client shape, not the server one.)
 *
 * The fold is read off the toolbar's action title, the same rendered surface
 * the torture suite reads: `hintOf` writes "site front page, N older
 * discussions" there on every folded frame, and it is per-tab truth that
 * needs no user gesture to observe — ten gestured panel-openings would test
 * the gesture plumbing ten times, not the fold.
 */
import * as fs from "node:fs"
import * as http from "node:http"
import * as path from "node:path"
import type { Page } from "playwright"
import { launch, SHOTS_PATH, type Harness } from "./harness.ts"
import { settle } from "./frontdoor.lib.ts"

const HOST = "parle-rootfold.com"
const DESTINATION_PATH = "/wiki/Main_Page"
const DESTINATION_TITLE = "Rootfold, the served encyclopedia"

/**
 * Longer than `SETTLES_AFTER` (400 ms) by a margin that stays adversarial on
 * a fast day and stays short of the navigation timeout on a slow one. This is
 * the knob that made the live flake deterministic: below the window the old
 * code passed, above it the old code failed every time.
 */
const REDIRECT_DELAY_MS = 700

/** Overridable for a quick pre-fix demonstration; the shipped check is ten. */
const VISITS = Number(process.env.ROOTFOLD_VISITS ?? 10)

/**
 * Eleven old submissions of the destination whose titles genuinely disagree —
 * the wikipedia shape: different events at one organisation, including an
 * outage. Mean pairwise agreement far below the 0.35 threshold, every one
 * outside the 30-day horizon, no `Show HN:`, so `FrontDoor.judge` folds them
 * all and the panel keeps not one row above the fold.
 */
const OLD_TITLES = [
  "Rootfold Is Down?",
  "Rootfold is blacked out",
  "Rootfold was down",
  "The strange history of a community project",
  "An editor war, ten years on",
  "Why the front page changed yesterday",
  "Fundraising banner considered harmful",
  "The servers behind a top-ten site",
  "A vandalism arms race",
  "Notability, argued again",
  "What moderators actually do all day"
] as const

const DAY_S = 24 * 60 * 60

/**
 * The real server. `/` answers a 301 after holding the socket open for one
 * whole network-weather delay — the defect's trigger, pinned — and the
 * destination is an ordinary document with a title.
 */
const startSite = (): Promise<{ readonly port: number; readonly close: () => Promise<void> }> =>
  new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const asked = new URL(request.url ?? "/", `http://${HOST}`)
      if (asked.pathname === "/") {
        setTimeout(() => {
          response.writeHead(301, { location: DESTINATION_PATH })
          response.end()
        }, REDIRECT_DELAY_MS)
        return
      }
      if (asked.pathname === DESTINATION_PATH) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        response.end(
          `<!doctype html><meta charset="utf-8"><title>${DESTINATION_TITLE}</title>` +
            `<h1>${DESTINATION_TITLE}</h1><p>Served by the rootfold harness.</p>`
        )
        return
      }
      response.writeHead(404)
      response.end()
    })
    server.listen(0, "127.0.0.1", () => {
      const bound = server.address()
      const port = typeof bound === "object" && bound !== null ? bound.port : 0
      resolve({
        port,
        close: () => new Promise((done) => server.close(() => done()))
      })
    })
  })

interface World {
  readonly algolia: Array<string>
}

/** Serve the Networks in-process; the pages come from the real server above. */
const stubWorld = async (h: Harness): Promise<World> => {
  const world: World = { algolia: [] }

  await h.context.route("**://hn.algolia.com/**", (route) => {
    const url = new URL(route.request().url())
    world.algolia.push(
      `${(url.searchParams.get("restrictSearchableAttributes") ?? "") === "url" ? "url" : "title"}: ` +
        (url.searchParams.get("query") ?? "")
    )
    const linked = (url.searchParams.get("restrictSearchableAttributes") ?? "") === "url"
    const query = url.searchParams.get("query") ?? ""
    const aboutDestination = (() => {
      try {
        return new URL(query).pathname === DESTINATION_PATH
      } catch {
        return false
      }
    })()
    const hits = linked && aboutDestination
      ? OLD_TITLES.map((title, index) => ({
        objectID: `97${String(index).padStart(6, "0")}`,
        title,
        url: query,
        author: "rootfold",
        // Well outside the 30-day horizon, spread so no two collapse.
        created_at_i: Math.floor(Date.now() / 1000) - (400 + index * 30) * DAY_S,
        points: 40 + index * 7,
        num_comments: 10 + index * 3
      }))
      : []
    return route
      .fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ hits, nbHits: hits.length, hitsPerPage: 50 })
      })
      .catch(() => {})
  })

  await h.context.route(/reddit\.com/, (route) =>
    route
      .fulfill({ status: 403, contentType: "text/html", body: "<html>blocked</html>" })
      .catch(() => {}))

  return world
}

/** Answer the first-run question the way a reader who said yes would. */
const agree = async (h: Harness) => {
  const welcome = await h.context.newPage()
  await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`)
  await welcome.bringToFront()
  await welcome.locator("#on").click().catch(() => {})
  await settle(800)
  await welcome.close()
}

/** The toolbar's one-line account of the tab — `hintOf`, read off the button. */
const actionHint = async (h: Harness, addressPrefix: string): Promise<string> => {
  const worker = h.context.serviceWorkers()[0]
  if (worker === undefined) return ""
  return worker
    .evaluate(async (prefix) => {
      const tabs = await chrome.tabs.query({})
      const tab = tabs.find((t) => (t.url ?? "").startsWith(prefix))
      if (tab?.id === undefined) return ""
      return chrome.action.getTitle({ tabId: tab.id })
    }, addressPrefix)
    .catch(() => "")
}

const until = async (check: () => Promise<boolean>, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return true
    await settle(400)
  }
  return check()
}

const PROFILE = path.resolve(SHOTS_PATH, "..", ".e2e-profile-rootfold")

interface Visit {
  readonly folded: boolean
  readonly hint: string
  readonly queries: ReadonlyArray<string>
}

const visitCold = async (port: number): Promise<Visit> => {
  // Cold means COLD: fresh disk, fresh worker, the first-run question unasked.
  // The battery's two misses were both cold profiles, and a warm profile's
  // remembered anything would make ten visits one measurement.
  fs.rmSync(PROFILE, { recursive: true, force: true })
  const h = await launch({
    profilePath: PROFILE,
    // The fake host resolves to the real local server, so the redirect is a
    // genuine server redirect over a genuine socket — see the file header for
    // why `route.fulfill` cannot stand in for one.
    args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`]
  })
  try {
    const world = await stubWorld(h)
    await agree(h)

    const root = `http://${HOST}:${port}/`
    const page: Page = h.context.pages()[0] ?? (await h.context.newPage())
    await page.bringToFront()
    await page.goto(root, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {})

    const folded = await until(
      async () => (await actionHint(h, root)).includes("site front page"),
      20_000
    )
    const hint = await actionHint(h, root)
    return { folded, hint, queries: [...world.algolia] }
  } finally {
    await h.close().catch(() => {})
  }
}

const main = async () => {
  fs.mkdirSync(SHOTS_PATH, { recursive: true })
  const site = await startSite()
  const visits: Array<Visit> = []
  for (let n = 1; n <= VISITS; n += 1) {
    const visit = await visitCold(site.port)
    visits.push(visit)
    console.log(
      `  visit ${String(n).padStart(2)}: ${visit.folded ? "FOLDED " : "UNFOLDED"} — ` +
        `${visit.hint || "(no hint drawn)"} — ${visit.queries.length} lookup(s)`
    )
    if (!visit.folded) {
      for (const q of visit.queries) console.log(`      wire: ${q}`)
    }
  }

  const folds = visits.filter((v) => v.folded).length
  console.log(
    `\nroot-fold under a ${REDIRECT_DELAY_MS} ms server redirect ` +
      `(settle window is 400 ms): ${folds}/${VISITS} cold visits folded`
  )
  if (folds !== VISITS) {
    console.error(
      "\nFAIL: the pre-redirect Alias did not reach the judgement on every " +
        "cold visit — F1 (BATTLE.md §4) has regressed."
    )
    process.exit(1)
  }
  console.log("OK: the origin Alias survived the slow redirect on every visit.")
  await site.close()
}

main().catch((error) => {
  console.error("ROOTFOLD RUN FAILED:", error)
  process.exit(1)
})
