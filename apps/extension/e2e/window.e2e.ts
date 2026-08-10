/**
 * ADR 0018, in a real Chrome: does the reader actually see the difference?
 *
 * Three questions the unit tests cannot answer, because they answer them
 * against a fake wire and a DOM double:
 *
 *   1. A page that fuzzy matching lost entirely now shows its Discussion.
 *   2. A page whose answer really was a window says so, in words, on screen.
 *   3. An ordinary page says nothing of the kind — a disclosure that appears
 *      everywhere is wallpaper.
 *
 * Deliberately not part of `pnpm e2e`: every address here is fetched for real
 * and every Lookup goes to the real Algolia endpoint. Run it with
 * `pnpm --filter @parle/extension e2e:window`.
 */
import * as path from "node:path"
import type { Browser, Page } from "playwright"
import {
  asideDocument,
  asideSurface,
  launch,
  pillPanel,
  SHOTS_PATH,
  type Surface,
  trustedClick
} from "./harness.ts"

const DEBUG_PORT = 9411
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SAYS = "reads in one go"

interface Seen {
  readonly text: string
  readonly on: string
  readonly rows: number
  readonly folded: number
  readonly discloses: boolean
  readonly foundNothing: boolean
}

const readSurface = async (aside: Surface): Promise<Seen> => {
  const text = await aside.text()
  return {
    text,
    on: (text.split("\n")[1] ?? "").trim(),
    rows: await aside.count(".parle-group-linked .parle-row"),
    folded: await aside.count(".parle-folded-rows .parle-row"),
    discloses: text.includes(SAYS),
    foundNothing: text.includes("Nobody has discussed this page")
  }
}

const visit = async (aside: Surface, page: Page, address: string): Promise<Seen> => {
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
    if (
      seen.on.includes(host) &&
      (seen.rows > 0 || seen.folded > 0 || seen.foundNothing || seen.discloses)
    ) break
  }
  return seen
}

const OPENERS = [
  "https://danluu.com/everything-is-broken/",
  "https://grugbrain.dev/",
  "https://paulgraham.com/greatwork.html"
]

const main = async () => {
  const h = await launch({
    debugPort: DEBUG_PORT,
    viewport: null,
    profilePath: path.resolve(SHOTS_PATH, "../.e2e-profile-window")
  })
  const page = h.context.pages()[0] ?? (await h.context.newPage())
  const remotes: Array<Browser> = []

  const welcome = await h.context.newPage()
  await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`)
  await welcome.locator("#on").click().catch(() => {})
  await settle(800)
  await welcome.close()

  let found: Awaited<ReturnType<typeof asideDocument>> = null
  for (const opener of OPENERS) {
    await page.bringToFront()
    await page.goto(opener, { waitUntil: "domcontentloaded" }).catch(() => {})
    await settle(8000)
    const pill = await pillPanel(page)
    await trustedClick(page, pill, ".parle-pill")
    await settle(2000)
    found = await asideDocument(DEBUG_PORT, 6)
    if (found !== null) break
  }
  if (found === null) {
    console.error("could not open the panel beside the page — nothing to read")
    process.exit(1)
  }
  remotes.push(found.remote)
  const aside = asideSurface(found.page)

  /** `expect` is what ADR 0018 claims this page does. */
  const cases = [
    // Both returned `nbHits: 0` under typo tolerance, against 2,611- and
    // 1,032-point threads. `raspberrypi.org` is NOT in this list: it 301s to
    // `raspberrypi.com/news/…`, which is a different Subject, so it would
    // measure the redirect rather than the fix.
    ["https://www.redhat.com/en/blog/red-hat-ibm-creating-leading-hybrid-cloud-provider", "recovered"],
    ["http://www.avc.com/a_vc/2011/06/enough-is-enough.html", "recovered"],
    // 50 hits out of roughly 2,000,000, and not one of them the front page.
    ["https://github.com/", "windowed"],
    // Classics. Four submissions, no window, nothing to disclose.
    ["https://grugbrain.dev/", "ordinary"],
    ["https://danluu.com/everything-is-broken/", "ordinary"]
  ] as const

  /**
   * The publisher sent the browser somewhere else, so the panel is describing a
   * different Subject.
   *
   * Never a pass and never a failure — it is a measurement that did not happen,
   * and calling it either would be the worst thing this file could do.
   * `avc.com/a_vc/2011/06/enough-is-enough.html` 301s to
   * `avc.com/2011/06/enough-is-enough/` and `raspberrypi.org` to
   * `raspberrypi.com`, and neither says anything about typo tolerance. It is
   * its own retrieval hole, named in ADR 0018 and larger than this one.
   */
  const landedElsewhere = (address: string, on: string): boolean => {
    const key = (raw: string) => {
      try {
        const u = new URL(raw)
        return u.host.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")
      } catch {
        return raw
      }
    }
    return on !== "" && key(on) !== key(address)
  }

  let wrong = 0
  for (const [address, expect] of cases) {
    const seen = await visit(aside, page, address)
    if (landedElsewhere(address, seen.on)) {
      console.log(`NOTE  ${expect.padEnd(9)} ${address}\n        redirected to ${seen.on} — a different Subject, not measured`)
      continue
    }
    const ok = expect === "recovered"
      ? seen.rows > 0 && !seen.discloses
      : expect === "windowed"
      ? seen.discloses
      : !seen.discloses && (seen.rows > 0 || seen.folded > 0)
    if (!ok) wrong += 1
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${expect.padEnd(9)} ${address}\n` +
        `        showing ${seen.rows}, folded ${seen.folded}, discloses=${seen.discloses}, on=${seen.on}`
    )
  }

  for (const remote of remotes) await remote.close().catch(() => {})
  await h.context.close().catch(() => {})
  console.log(wrong === 0 ? "\nevery page measured behaved as ADR 0018 claims" : `\n${wrong} unexpected`)
  process.exit(wrong === 0 ? 0 : 1)
}

void main()
