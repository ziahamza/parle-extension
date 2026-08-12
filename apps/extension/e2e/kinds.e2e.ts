/**
 * The page-KIND sweep: runs `kinds.corpus.ts` against a real Chrome, the real
 * extension, and the real Algolia endpoint.
 *
 * Same contract as the front-door sweep and deliberately the same shape: the
 * corpus is data, the verdicts are computed here, the report prints one row per
 * scenario — expectation, actual, verdict — and a WRONG is never summarised
 * away. Where reality disagrees with an ADR-derived expectation, the row says
 * so; the corpus is never edited to agree with a run.
 *
 * Two things this runner adds over `frontdoor.e2e.ts`:
 *
 *   - **Served fixtures.** A scenario may carry pages that `context.route`
 *     fulfills, including 302 chains, CSP headers and SPA routers — the shapes
 *     that cannot be relied on live. The Lookups they provoke still go out for
 *     real; only the page fetch is synthesized.
 *   - **The politeness gate** (ADR 0014). Algolia meters the reader's IP and
 *     every harness on this box shares one, so every navigation is paid for
 *     through the same `gate.ts` the sharded sweep uses — one gate for a whole
 *     run, never one per process. Run standalone this starts its own; run
 *     beside other harnesses, `SWEEP_GATE_URL` points everyone at the one gate.
 *     The gate is the budget and the CDP observer (`traffic.ts`) is the audit:
 *     the closing report states MEASURED peak and sustained req/s, not the
 *     budget the run intended.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import type { Browser, Page, Request } from "playwright"
import { asideSurface, launch, SHOTS_PATH, type Surface } from "./harness.ts"
import { OPENERS } from "./frontdoor.corpus.ts"
import { armAndOpenAside, readSurface, settle, type Seen } from "./frontdoor.lib.ts"
import { acquireVisit, startGate, type Gate } from "./gate.ts"
import { ratesOf, watchTraffic } from "./traffic.ts"
import { POLITENESS, SCENARIOS, type Expect } from "./kinds.corpus.ts"

const DEBUG_PORT = 9418
const ALGOLIA = "https://hn.algolia.com/api/v1/search"

// ---------------------------------------------------------------- accounting

interface Sighted {
  readonly url: string
  readonly at: number
  /** True when Playwright attributes the request to a service worker. */
  readonly sw: boolean
}

interface AlgoliaAsk {
  readonly at: number
  readonly raw: string
  /** The decoded `query` parameter — an address or a title. */
  readonly query: string
  /** True for `restrictSearchableAttributes=url`, i.e. an address Lookup. */
  readonly byAddress: boolean
}

const asksOf = (traffic: ReadonlyArray<Sighted>): ReadonlyArray<AlgoliaAsk> =>
  traffic
    .filter((t) => t.url.startsWith(ALGOLIA))
    .map((t) => {
      const u = new URL(t.url)
      return {
        at: t.at,
        raw: t.url,
        query: u.searchParams.get("query") ?? "",
        byAddress: u.searchParams.get("restrictSearchableAttributes") === "url"
      }
    })

// -------------------------------------------------------------------- report

interface Verdict {
  readonly id: string
  readonly kind: string
  readonly adr: ReadonlyArray<string>
  readonly verdict: "ok" | "WRONG" | "note"
  readonly actual: string
  /** Each assertion that did not hold, by name. */
  readonly failed: ReadonlyArray<string>
  readonly detail: string
  /** Every decoded Algolia query the scenario provoked, for the record. */
  readonly queries: ReadonlyArray<string>
}

const rows: Array<Verdict> = []

const actualOf = (seen: Seen): string =>
  seen.excluded
    ? "on the skip list"
    : seen.folded > 0
    ? `folded ${seen.folded}${seen.shown > 0 ? `, showing ${seen.shown}` : ""}`
    : seen.shown > 0
    ? `showing ${seen.shown}${seen.topical > 0 ? ` (+${seen.topical} topical)` : ""}`
    : seen.topical > 0
    ? `${seen.topical} topical`
    : seen.foundNothing
    ? "nothing found"
    : seen.refused !== ""
    ? `refused (${seen.refused})`
    : "nothing"

// --------------------------------------------------------------- the checks

interface Assertion {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

const judge = (
  expect: Expect,
  seen: Seen,
  asks: ReadonlyArray<AlgoliaAsk>,
  asksAfterMark: ReadonlyArray<AlgoliaAsk>,
  swWindow: ReadonlyArray<Sighted>,
  repeatClause: string,
  windowNoted: boolean,
  ourConsole: ReadonlyArray<string>,
  recollectionGained: ReadonlyArray<string>
): ReadonlyArray<Assertion> => {
  const out: Array<Assertion> = []
  const addressAsks = asks.filter((a) => a.byAddress)
  const put = (name: string, ok: boolean, detail = "") => out.push({ name, ok, detail })

  for (const want of expect.queried ?? []) {
    put(`queried ${want}`, asks.some((a) => a.query.includes(want)),
      `queries: ${asks.map((a) => a.query).join(" | ").slice(0, 200)}`)
  }
  for (const want of expect.queriedExactly ?? []) {
    put(`queried exactly ${want}`, addressAsks.some((a) => a.query === want),
      `address queries: ${addressAsks.map((a) => a.query).join(" | ").slice(0, 200)}`)
  }
  for (const never of expect.neverQueried ?? []) {
    const hit = asks.filter((a) => a.query.includes(never))
    put(`never queried ${never}`, hit.length === 0, hit.map((a) => a.query).join(" | ").slice(0, 160))
  }
  for (const never of expect.neverQueriedExactly ?? []) {
    put(`never queried exactly ${never}`, !addressAsks.some((a) => a.query === never))
  }
  if (expect.titleQueried !== undefined) {
    const titles = asks.filter((a) => !a.byAddress)
    put(`title queried byte-stable`, titles.some((a) => a.query === expect.titleQueried),
      `title queries: ${titles.map((a) => a.query).join(" | ").slice(0, 160)}`)
  }
  if (expect.atMostAlgolia !== undefined) {
    put(`at most ${expect.atMostAlgolia} requests`, asks.length <= expect.atMostAlgolia, `${asks.length} sent`)
  }
  if (expect.quietAfterMark !== undefined) {
    const noisy = asksAfterMark.filter((a) => a.query.includes(expect.quietAfterMark ?? ""))
    put(`quiet after first burst`, noisy.length === 0, noisy.map((a) => a.query).join(" | ").slice(0, 160))
  }
  if (expect.noFragmentInQueries === true) {
    const carrying = asks.filter((a) => a.query.includes("#") || a.raw.includes("%23"))
    put("no fragment ever sent", carrying.length === 0, carrying.map((a) => a.query).join(" | "))
  }
  if (expect.linkedAtLeast !== undefined) {
    put(`linked rows >= ${expect.linkedAtLeast}`, seen.shown >= expect.linkedAtLeast, `${seen.shown} shown`)
  }
  if (expect.topicalAtLeast !== undefined) {
    put(`topical rows >= ${expect.topicalAtLeast}`, seen.topical >= expect.topicalAtLeast, `${seen.topical} drawn`)
  }
  if (expect.topicalAtMost !== undefined) {
    put(`topical rows <= ${expect.topicalAtMost}`, seen.topical <= expect.topicalAtMost, `${seen.topical} drawn`)
  }
  if (expect.foldedAtLeast !== undefined) {
    put(`folded rows >= ${expect.foldedAtLeast}`, seen.folded >= expect.foldedAtLeast, `${seen.folded} folded`)
  }
  if (expect.nothingShown === true) {
    put("no discussion rows drawn", seen.shown === 0 && seen.folded === 0 && seen.topical === 0,
      `${seen.shown} shown, ${seen.folded} folded, ${seen.topical} topical`)
  }
  if (expect.excluded === true) put("says it is not looking this page up", seen.excluded)
  if (expect.repeatClauseAtLeast !== undefined) {
    const m = /also submitted (once|(\d+) times)/.exec(repeatClause)
    const n = m === null ? 0 : m[1] === "once" ? 1 : Number(m[2])
    put(`repeat clause >= ${expect.repeatClauseAtLeast}`, n >= expect.repeatClauseAtLeast,
      repeatClause || "no clause drawn")
  }
  if (expect.noWindowNote === true) {
    put("no 'not all of them' claim", !windowNoted)
  }
  if (expect.consoleClean === true) {
    put("no console error from our code", ourConsole.length === 0, ourConsole.join(" | ").slice(0, 200))
  }
  if (expect.gainsRecollection === true) {
    put("harvest wrote rows", recollectionGained.length > 0, `${recollectionGained.length} new row(s)`)
  }
  if (expect.recollectionKeyed !== undefined) {
    put(`harvested row keyed on ${expect.recollectionKeyed}`,
      recollectionGained.some((k) => k.includes(expect.recollectionKeyed ?? "")),
      recollectionGained.slice(0, 3).join(" | ").slice(0, 160))
  }
  if (expect.swTrafficOnlyTo !== undefined) {
    const sw = swWindow.filter((t) => t.sw)
    const strays = sw.filter((t) => !(expect.swTrafficOnlyTo ?? []).some((h) => new URL(t.url).hostname.endsWith(h)))
    put(
      "worker traffic only to the Networks",
      strays.length === 0,
      sw.length === 0
        ? "attribution unavailable (0 worker-attributed requests seen)"
        : strays.length === 0
        ? `${sw.length} worker request(s), all accounted for`
        : strays.map((t) => t.url).slice(0, 3).join(" | ")
    )
  }
  return out
}

// ----------------------------------------------------------------- the sweep

const main = async () => {
  fs.mkdirSync(SHOTS_PATH, { recursive: true })
  const profilePath = path.resolve(SHOTS_PATH, "../.e2e-profile-kinds")

  // One gate for the run. Standalone, this process owns it; under a
  // coordinator, SWEEP_GATE_URL names the one everyone shares.
  let ownedGate: Gate | null = null
  let gateUrl = process.env.SWEEP_GATE_URL
  if (gateUrl === undefined) {
    ownedGate = await startGate(POLITENESS)
    gateUrl = ownedGate.url
  }
  const paced = (address: string) => acquireVisit(gateUrl, profilePath, address).then(() => {})

  const h = await launch({
    debugPort: DEBUG_PORT,
    viewport: null,
    profilePath
  })

  /**
   * Every served fixture, installed as ONE route before anything navigates.
   *
   * Not one `context.route()` per scenario, and the reason cost two runs to
   * learn: a `context.route()` call made mid-run, right after a live page that
   * registers its own service worker (wikipedia's) has loaded, never returns —
   * Playwright has to enable interception across every target and one of them
   * does not answer. Deterministic both times, at the same scenario. Routing
   * once, before any page exists, avoids the whole class.
   *
   * A later scenario's fixture for the same address wins over an earlier one
   * (`Map` keeps the last write), which is what the two servings of the nature
   * article want: the strict-CSP variant is the stricter of the two.
   */
  const fixtures = new Map(SCENARIOS.flatMap((s) => (s.serve ?? []).map((p) => [p.address, p] as const)))
  await h.context.route(
    (url) => fixtures.has(url.href),
    (route) => {
      const served = fixtures.get(route.request().url())
      if (served === undefined) return route.fallback()
      const base = {
        status: served.status ?? 200,
        body: served.body ?? ""
      }
      if (served.status === undefined && served.headers !== undefined) {
        return route.fulfill({ ...base, contentType: "text/html", headers: { ...served.headers } })
      }
      if (served.status === undefined) {
        return route.fulfill({ ...base, contentType: "text/html" })
      }
      if (served.headers !== undefined) {
        return route.fulfill({ ...base, headers: { ...served.headers } })
      }
      return route.fulfill(base)
    }
  )

  // The audit half: what was ACTUALLY sent, stamped on the wire over CDP —
  // the only route that sees the background worker's own fetches reliably.
  const audit = await watchTraffic(
    `http://127.0.0.1:${DEBUG_PORT}`,
    (url) => url.includes("hn.algolia.com")
  )
  const page = h.context.pages()[0] ?? (await h.context.newPage())
  const remotes: Array<Browser> = []

  const traffic: Array<Sighted> = []
  h.context.on("request", (r: Request) => {
    let sw = false
    try {
      // SAFETY: Playwright's Request exposes serviceWorker() at runtime; types omit it here.
      sw = (r as { serviceWorker?: () => object | undefined }).serviceWorker?.() != null
    } catch {
      /* attribution is best-effort */
    }
    traffic.push({ url: r.url(), at: Date.now(), sw })
  })

  /** Console lines attributable to our code, per current scenario window. */
  let ourConsole: Array<string> = []
  const watchPage = (p: Page) => {
    p.on("console", (m) => {
      if (m.type() !== "error") return
      const from = m.location().url ?? ""
      if (from.includes("chrome-extension://") || m.text().includes("chrome-extension://")) {
        ourConsole.push(`[console] ${m.text().slice(0, 160)}`)
      }
    })
    p.on("pageerror", (e) => {
      if ((e.stack ?? "").includes("chrome-extension://")) {
        ourConsole.push(`[pageerror] ${e.message.slice(0, 160)}`)
      }
    })
  }
  h.context.pages().forEach(watchPage)
  h.context.on("page", watchPage)

  // Openers are real page-loads that spend real Lookups; pay for them too.
  const found = await armAndOpenAside(h, page, OPENERS, DEBUG_PORT, paced)
  if (found === null) {
    console.error("could not open the panel beside the page — nothing to read")
    process.exit(1)
  }
  remotes.push(found.remote)
  const aside = asideSurface(found.page)
  console.log(`panel beside the page: ${(await aside.text()).length} chars\n`)

  /** A promise that gives up rather than hanging the sweep. */
  const within = async <A>(what: string, ms: number, work: Promise<A>, fallback: A): Promise<A> => {
    let timer: NodeJS.Timeout | undefined
    const gaveUp = new Promise<A>((resolve) => {
      timer = setTimeout(() => {
        console.log(`         (gave up on ${what} after ${ms} ms)`)
        resolve(fallback)
      }, ms)
    })
    const answer = await Promise.race([work, gaveUp])
    clearTimeout(timer)
    return answer
  }

  const runScenario = async (scenario: (typeof SCENARIOS)[number]): Promise<void> => {
    const from = traffic.length
    let markAt = 0
    const keysBefore = new Set(await within("storedKeys before", 10_000, h.storedKeys(), []))
    ourConsole = []
    let navStatus: number | null = null
    let landedHost = ""
    let gotoHost = ""

    for (const step of scenario.drive) {
      console.log(`  step ${JSON.stringify(step).slice(0, 90)}`)
      if ("goto" in step) {
        await within("the gate", 30_000, paced(step.goto), undefined)
        gotoHost = new URL(step.goto).hostname.replace(/^www\./, "")
        await page.bringToFront()
        const answer = await page
          .goto(step.goto, { waitUntil: "domcontentloaded", timeout: 30_000 })
          .catch(() => null)
        navStatus = answer?.status() ?? navStatus
      } else if ("click" in step) {
        // A click that navigates an SPA costs Lookups like a page-load does,
        // and each is a fresh address, so it is charged as one.
        await within("the gate", 30_000, paced(`${scenario.id} ${step.click}`), undefined)
        await page.locator(step.click).first().click({ timeout: 5_000 }).catch(() => {})
      } else if ("waitMs" in step) {
        await settle(step.waitMs)
      } else if ("awaitQueried" in step) {
        const deadline = Date.now() + 15_000
        while (Date.now() < deadline) {
          if (asksOf(traffic.slice(from)).some((a) => a.query.includes(step.awaitQueried))) break
          await settle(300)
        }
      } else if ("mark" in step) {
        markAt = Date.now()
      }
    }
    try {
      landedHost = new URL(page.url()).hostname.replace(/^www\./, "")
    } catch {
      landedHost = ""
    }

    // Let the Enquiry settle and the panel land on this scenario's address.
    // "Settled" is two consecutive identical readings with some outcome on
    // them, not the first outcome seen: the topical answer (one request) lands
    // seconds before the linked one (four), and a read taken between the two
    // counts a page's own submissions as zero. That mis-scored a page with 31
    // submissions on this sweep's first full run.
    let seen = await readSurface(aside)
    let previous = ""
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const now = `${seen.on}|${seen.shown}|${seen.topical}|${seen.folded}|${seen.foundNothing}|${seen.excluded}|${seen.refused}`
      const landed = seen.on.includes(scenario.expect.panelOn) &&
        (seen.shown > 0 || seen.topical > 0 || seen.folded > 0 || seen.foundNothing ||
          seen.excluded || seen.refused !== "")
      if (landed && now === previous) break
      previous = now
      await settle(900)
      seen = await readSurface(aside)
    }

    const windowTraffic = traffic.slice(from)
    const asks = asksOf(windowTraffic)
    const asksAfterMark = markAt === 0 ? [] : asks.filter((a) => a.at >= markAt)
    const repeatClause = await aside.textOf(".parle-repeat")
    const windowNoted = seen.text.includes("not all of them")
    const keysAfter = await within("storedKeys after", 10_000, h.storedKeys(), [])
    const gained = keysAfter.filter((k) => k.startsWith("parle/recollection/") && !keysBefore.has(k))

    const assertions = judge(
      scenario.expect, seen, asks, asksAfterMark, windowTraffic,
      repeatClause, windowNoted, ourConsole, gained
    )
    const failed = assertions.filter((a) => !a.ok)

    // A measurement that did not happen is neither a pass nor a failure.
    const offCourse = !seen.on.includes(scenario.expect.panelOn)
    const interfered = scenario.fragile !== undefined &&
      ((navStatus !== null && navStatus >= 400) || (landedHost !== "" && gotoHost !== "" && landedHost !== gotoHost))
    const verdict: Verdict = {
      id: scenario.id,
      kind: scenario.kind,
      adr: scenario.adr,
      verdict: offCourse
        ? "note"
        : failed.length === 0
        ? "ok"
        : interfered
        ? "note"
        : "WRONG",
      actual: actualOf(seen),
      failed: failed.map((a) => `${a.name}${a.detail === "" ? "" : ` (${a.detail})`}`),
      detail: offCourse
        ? `panel was on ${seen.on || "nothing"}`
        : interfered && failed.length > 0
        ? `interference: ${scenario.fragile} — status ${navStatus ?? "?"}, landed on ${landedHost}`
        : "",
      queries: asks.map((a) => `${a.byAddress ? "url" : "title"}: ${a.query}`)
    }
    rows.push(verdict)
    console.log(`  ${verdict.verdict === "ok" ? "ok   " : verdict.verdict === "note" ? "note " : "WRONG"} ` +
      `${verdict.actual.padEnd(24)} ${asks.length} lookup(s)`)
    for (const miss of verdict.failed) console.log(`         failed: ${miss}`)
    if (verdict.detail !== "") console.log(`         ${verdict.detail}`)

    await within(
      "the screenshot",
      15_000,
      found.page.screenshot({
        path: path.join(SHOTS_PATH, `kind-${scenario.id}.png`),
        fullPage: true
      }).then(() => {}).catch(() => {}),
      undefined
    )
  }

  for (const scenario of SCENARIOS) {
    console.log(`\n=== ${scenario.kind} / ${scenario.id} ===`)
    // A scenario that hangs is a note, never a wall: the sweep's job is the
    // whole corpus, and one stuck CDP call must not cost the remaining kinds.
    const finished = await within("the scenario", 180_000, runScenario(scenario).then(() => true), false)
    if (!finished) {
      rows.push({
        id: scenario.id,
        kind: scenario.kind,
        adr: scenario.adr,
        verdict: "note",
        actual: "timed out",
        failed: [],
        detail: "the scenario did not finish inside 180 s — a measurement that did not happen",
        queries: []
      })
    }
  }

  // ------------------------------------------------------------- accounting
  const rates = ratesOf(audit.seen.map((r) => r.at))
  console.log("\n=== The table ===\n")
  console.log("| kind | scenario | actual | verdict |")
  console.log("|---|---|---|---|")
  for (const row of rows) {
    console.log(`| ${row.kind} | ${row.id} | ${row.actual}${row.detail ? ` — ${row.detail}` : ""} | ${row.verdict} |`)
  }
  const wrong = rows.filter((r) => r.verdict === "WRONG")
  const notes = rows.filter((r) => r.verdict === "note")
  console.log(
    `\n${rows.length - wrong.length - notes.length}/${rows.length} as expected, ` +
      `${wrong.length} wrong, ${notes.length} not measured`
  )
  if (wrong.length > 0) {
    console.log("\nWRONG (reality disagrees with the ADR-derived expectation):")
    for (const row of wrong) {
      console.log(`  ${row.id} [ADR ${row.adr.join(", ")}]`)
      for (const miss of row.failed) console.log(`    ${miss}`)
    }
  }
  console.log(
    `\npoliteness (measured on the wire, ADR 0014):\n` +
      `  algolia requests:  ${rates.total}\n` +
      `  peak:              ${rates.peakPerSecond} req/s (worst one-second window)\n` +
      `  sustained:         ${rates.sustainedPerSecond} req/s (budget ${POLITENESS.requestsPerSecond})` +
      (ownedGate === null
        ? `\n  gate:              shared at ${gateUrl}`
        : `\n  gate:              own, ${JSON.stringify(ownedGate.tally())}`)
  )
  // Raw wall-clock stamps ride along so a coordinator that ran this beside
  // other harnesses can merge ONE measured peak/sustained across everything
  // that shared the IP — rates computed per-runner cannot be merged, stamps
  // can. `KINDS_OUT` is where a coordinator asked for its copy.
  const report = { rows, algolia: rates, stamps: audit.seen.map((r) => r.at) }
  fs.writeFileSync(path.join(SHOTS_PATH, "kinds-sweep.json"), JSON.stringify(report, null, 2))
  if (process.env.KINDS_OUT !== undefined) {
    fs.writeFileSync(process.env.KINDS_OUT, JSON.stringify(report, null, 2))
  }
  audit.close()
  for (const remote of remotes) await remote.close().catch(() => {})
  await h.close()
  if (ownedGate !== null) await ownedGate.close()
}

main().catch((error) => {
  console.error("SWEEP FAILED:", error)
  process.exit(1)
})
