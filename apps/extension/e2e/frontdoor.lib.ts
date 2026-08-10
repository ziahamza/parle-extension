/**
 * What one front-door measurement IS, shared verbatim by both runners.
 *
 * `frontdoor.e2e.ts` runs the corpus in one process; `sweep.e2e.ts` splits it
 * across N harnesses. The reading, the judging and the accounting must be the
 * same code in both, or a page could pass sequentially and fail sharded and
 * nobody could say which runner was wrong. So everything that decides a verdict
 * lives here, and the runners only decide who visits what, when.
 */
import { type Page } from "playwright"
import {
  asideDocument,
  pillPanel,
  trustedClick,
  type Harness,
  type Surface
} from "./harness.ts"

export const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type Expected = "shows" | "folds" | "quiet"

export interface Row {
  readonly url: string
  readonly expected: Expected
  readonly actual: string
  readonly verdict: "ok" | "WRONG" | "note"
  readonly detail: string
}

/** What the surface beside the page says about one address, read as a whole. */
export interface Seen {
  readonly text: string
  /** The address the panel says it is describing — checked, never assumed. */
  readonly on: string
  /** Rows the reader can see and click, by tier. */
  readonly shown: number
  readonly topical: number
  /** Rows kept behind the fold. Present in the DOM, hidden until asked for. */
  readonly folded: number
  readonly foundNothing: boolean
  /** The Exclusion List got there first — a different mechanism entirely. */
  readonly excluded: boolean
  readonly refused: string
}

/**
 * The surface beside the page, which is what a reader on Chrome actually looks
 * at — and the only one of the three that can be read for a page under test.
 *
 * Not the toolbar popup, and the reason is a harness fact worth writing down.
 * Opened as a page rather than as a real popup, the popup's port carries
 * `sender.tab` — its OWN tab — so `Watch(null)` resolves to the popup itself and
 * it reports "this is not a public web page" for every address in the sweep.
 * That is what the first two runs of this sweep recorded, for all 27 Hacker News
 * links and all 7 classics, and it was a fact about the harness rather than
 * about the product.
 *
 * Rows are COUNTED rather than read out of a summary sentence, and that is the
 * second thing this sweep got wrong before it got it right: `renderAside` draws
 * the page surface when there is anything to show and the toolbar surface when
 * there is not, and only the second one carries "N discussions on this page."
 * Scraping that sentence reports every page that has Discussions as having none.
 */
export const readSurface = async (aside: Surface): Promise<Seen> => {
  const text = await aside.text()
  const refusals = [
    ["refused us", "forbidden"],
    ["rate-limiting us", "rate-limited"],
    ["no answer in time", "timed out"],
    ["you are not signed in", "not signed in"],
    ["could not reach it", "offline"]
  ] as const
  return {
    text,
    on: (text.split("\n")[1] ?? "").trim(),
    shown: await aside.count(".parle-group-linked .parle-row"),
    topical: await aside.count(".parle-group-topical .parle-row"),
    // The rows themselves, not the number in the sentence: a count that came
    // from the copy would agree with the copy by construction.
    folded: await aside.count(".parle-folded-rows .parle-row"),
    foundNothing: text.includes("Nobody has discussed this page"),
    excluded: text.includes("on the built-in list") || text.includes("Parle isn't looking this page up"),
    refused: refusals.filter(([needle]) => text.includes(needle)).map(([, name]) => name).join(", ")
  }
}

/**
 * Open one address for real, wait for its Enquiry, then read the surface.
 *
 * Waits until the panel says it is describing THIS address rather than for a
 * fixed time. The panel beside the page survives navigation, so a fixed wait
 * that is one second short reports the previous page's Discussions as this
 * page's — which is the failure that looks least like one.
 */
export const visit = async (aside: Surface, page: Page, address: string): Promise<Seen> => {
  await page.bringToFront()
  await page.goto(address, { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => {})
  const host = (() => {
    try {
      return new URL(address).hostname.replace(/^www\./, "")
    } catch {
      return address
    }
  })()
  let seen = await readSurface(aside)
  for (let attempt = 0; attempt < 14; attempt += 1) {
    await settle(700)
    seen = await readSurface(aside)
    const settled = seen.on.includes(host) &&
      (seen.shown > 0 || seen.folded > 0 || seen.foundNothing || seen.excluded || seen.refused !== "")
    if (settled) break
  }
  return seen
}

export const judge = (url: string, expected: Expected, seen: Seen): Row => {
  const actual = seen.excluded
    ? "on the skip list"
    : seen.folded > 0
    ? `folded ${seen.folded}${seen.shown > 0 ? `, showing ${seen.shown}` : ""}`
    : seen.shown > 0
    ? `showing ${seen.shown}`
    : seen.foundNothing
    ? "nothing found"
    : seen.refused !== ""
    ? `refused (${seen.refused})`
    : "nothing"

  // The panel is describing a different page. Never a pass and never a failure
  // — it is a measurement that did not happen, and calling it either would be
  // the worst thing this sweep could do.
  if (!seen.on.includes((() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "")
    } catch {
      return url
    }
  })())) {
    return { url, expected, actual, verdict: "note", detail: `panel was on ${seen.on || "nothing"}` }
  }

  // The Exclusion List got there first. A real outcome, and nothing to do with
  // this rule — reported separately so the two cannot be confused.
  if (seen.excluded) return { url, expected, actual, verdict: "note", detail: "excluded upstream" }

  // Nobody has discussed this page, so the rule was never consulted: it is only
  // ever a judgement about Discussions that exist.
  if (seen.shown === 0 && seen.folded === 0 && expected !== "quiet") {
    return { url, expected, actual, verdict: "note", detail: "nothing came back to judge" }
  }

  const ok = expected === "shows"
    ? seen.shown > 0 && seen.folded === 0
    : expected === "folds"
    ? seen.folded > 0
    : seen.shown === 0
  // The address the panel is on, whenever the site sent us somewhere else.
  // Five of the front doors in the corpus redirect — microsoft.com to /de-de,
  // netflix.com to /fi-en/, gitlab.com to about.gitlab.com — and a table that
  // did not say so would be reporting the rule's behaviour on a page nobody
  // asked it about.
  const landed = seen.on.replace(/^https?:\/\//, "")
  const asked = url.replace(/^https?:\/\//, "")
  // A quiet verdict under a standing refusal is only half a measurement: on
  // this box Reddit 403s every Lookup, so "no rows" certifies Hacker News'
  // silence alone, and the table must say so rather than let a refusal pass as
  // proof of quiet (ADR 0005: a refusal is never evidence of silence). Two
  // batteries' comparison caught rows flipping ok<->WRONG on exactly this.
  const halfMeasured = expected === "quiet" && ok && seen.refused !== ""
    ? `a Network refused (${seen.refused}) — quiet certified for the answering Networks only`
    : ""
  return {
    url,
    expected,
    actual,
    verdict: ok ? "ok" : "WRONG",
    detail: landed !== asked && landed !== ""
      ? `landed on ${seen.on}`
      : halfMeasured
  }
}

/** One line of the live log, identical in both runners. */
export const rowLine = (row: Row): string =>
  `  ${row.verdict === "ok" ? "ok   " : row.verdict === "note" ? "note " : "WRONG"} ` +
    `${row.expected.padEnd(6)} ${row.actual.padEnd(22)} ${row.url}`

/**
 * Read the Reddit refusal off the surface — the Network itself, whose 403 is
 * the thing under test: it has to render as a refusal, never as "nobody has
 * discussed this page".
 *
 * One outcome here is neither: the Exclusion List speaking first. `reddit.com`
 * is seeded `social` (`packages/policy/src/Seed.ts` — "a Lookup on them is
 * self-referential and pointless"), so on the Network's OWN page no Lookup runs
 * and there is no refusal to render. That is the deliberate design, and this
 * judge predates it: it read the resulting "isn't looking this page up" as a
 * WRONG for a rendering that was never attempted. Same rule as `judge` above —
 * excluded upstream is a measurement that did not happen. The refusal render
 * stays measured where a refusal genuinely occurs: the torture suite's served
 * 403s, and any Reddit-shaped page that is not itself excluded. What remains
 * WRONG on this row is the one lie ADR 0005 names: "nobody has discussed this
 * page" about a page whose Network was never asked or answered with a 403.
 */
export const judgeRedditNetwork = (seen: Seen): Row => {
  const redditLine = /Reddit · by address\s*\n?\s*([^\n]*)/.exec(seen.text)
  const url = "old.reddit.com/r/programming (the Network itself)"
  if (seen.foundNothing) {
    return {
      url,
      expected: "quiet",
      actual: "nothing found",
      verdict: "WRONG",
      detail: "reported as nobody having discussed it"
    }
  }
  if (seen.excluded) {
    return {
      url,
      expected: "quiet",
      actual: "on the skip list",
      verdict: "note",
      detail: "excluded upstream — no Lookup ran, so the refusal render was never measured"
    }
  }
  return {
    url,
    expected: "quiet",
    actual: seen.refused !== "" ? `refused (${seen.refused})` : `not refused — ${redditLine?.[1]?.trim() ?? "?"}`,
    verdict: seen.refused !== "" ? "ok" : "WRONG",
    detail: ""
  }
}

/**
 * Arm the extension and open the panel beside the page, once, with a real
 * gesture on a page that has a mark.
 *
 * Nothing automatic runs until the reader has been asked, so a sweep that skips
 * the welcome step measures an inert extension and reports every page as quiet.
 * And `chrome.sidePanel.open()` is refused without a user gesture, which is why
 * the openers exist at all.
 *
 * `beforeNavigate` is the shared politeness gate's hook: every opener is a real
 * page-load that makes the extension ask Hacker News, so a sharded run has to
 * pace these exactly like corpus visits.
 */
export const armAndOpenAside = async (
  h: Harness,
  page: Page,
  openers: ReadonlyArray<string>,
  debugPort: number,
  beforeNavigate?: (address: string) => Promise<void>
): Promise<Awaited<ReturnType<typeof asideDocument>>> => {
  const welcome = await h.context.newPage()
  await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`)
  await welcome.locator("#on").click().catch(() => {})
  await settle(800)
  await welcome.close()

  for (const opener of openers) {
    if (beforeNavigate !== undefined) await beforeNavigate(opener)
    await page.bringToFront()
    await page.goto(opener, { waitUntil: "domcontentloaded" }).catch(() => {})
    await settle(8000)
    const pill = await pillPanel(page)
    await trustedClick(page, pill, ".parle-pill")
    await settle(2000)
    const found = await asideDocument(debugPort, 6)
    if (found !== null) return found
  }
  return null
}

/**
 * Which scraped front-page links the sweep keeps: http(s) only, never a
 * Network's own host, and one per host — twelve nytimes.com articles measure
 * one publisher, and the sweep is about breadth. Pure, so the sequential
 * runner (which has a browser and reads `.href` off anchors) and the sharded
 * coordinator (which fetches the HTML and has no browser) keep identical lists
 * from identical input.
 */
export const keepLinks = (
  hrefs: ReadonlyArray<string>,
  want: number,
  skipHosts: ReadonlyArray<string>
): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const kept: Array<string> = []
  for (const href of hrefs) {
    if (!href.startsWith("http")) continue
    let host: string
    try {
      host = new URL(href).hostname.replace(/^www\./, "")
    } catch {
      continue
    }
    if (skipHosts.some((skip) => host.endsWith(skip)) || seen.has(host)) continue
    seen.add(host)
    kept.push(href)
    if (kept.length >= want) break
  }
  return kept
}

/**
 * The closing accounting, shared so "54/82" means the same thing whoever adds
 * it up: right / wrong / nothing-to-judge, and a WRONG is never summarised
 * away.
 */
export const printReport = (rows: ReadonlyArray<Row>): { readonly wrong: number } => {
  console.log("\n=== The table ===\n")
  console.log("| URL | expected | actual | verdict |")
  console.log("|---|---|---|---|")
  for (const row of rows) {
    console.log(`| ${row.url} | ${row.expected} | ${row.actual}${row.detail ? ` — ${row.detail}` : ""} | ${row.verdict} |`)
  }
  const wrong = rows.filter((r) => r.verdict === "WRONG")
  const notes = rows.filter((r) => r.verdict === "note")
  console.log(
    `\n${rows.length - wrong.length - notes.length}/${rows.length} as expected, ` +
      `${wrong.length} wrong, ${notes.length} nothing to judge`
  )
  if (wrong.length > 0) {
    console.log("\nWRONG:")
    for (const row of wrong) console.log(`  ${row.url} — expected ${row.expected}, got ${row.actual}`)
  }
  return { wrong: wrong.length }
}
