/**
 * One shard of the sharded front-door sweep: its own Chrome, its own profile,
 * its own display, one slice of the corpus.
 *
 * Everything that decides a verdict is imported from `frontdoor.lib.ts`, so a
 * shard judges a page exactly as the sequential runner does — the only things
 * a shard adds are (a) asking the run-wide politeness gate before every
 * navigation, because its Chrome shares this box's IP with every other shard,
 * and (b) stamping every real `hn.algolia.com` request via CDP so the merged
 * report states measured politeness rather than intended politeness.
 *
 * Spawned by `sweep.e2e.ts` with DISPLAY already set (see `display.ts`) and a
 * spec file naming the work. Never run by hand; run `e2e:sweep`.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { launch, SHOTS_PATH } from "./harness.ts"
import { acquireVisit } from "./gate.ts"
import { watchTraffic } from "./traffic.ts"
import {
  armAndOpenAside,
  judge,
  judgeRedditNetwork,
  rowLine,
  settle,
  visit,
  type Expected,
  type Row
} from "./frontdoor.lib.ts"

export interface ShardSpec {
  readonly shard: number
  readonly debugPort: number
  readonly profilePath: string
  readonly gateUrl: string
  readonly openers: ReadonlyArray<string>
  readonly rows: ReadonlyArray<{
    readonly index: number
    readonly url: string
    readonly expected: Expected
    /** The one special row: the Network whose refusal is itself under test. */
    readonly kind?: "reddit-network"
  }>
  readonly shots: ReadonlyArray<readonly [name: string, url: string]>
  readonly outPath: string
}

export interface ShardResult {
  readonly shard: number
  readonly rows: ReadonlyArray<Row & { readonly index: number }>
  /** Wall-clock stamps of every Algolia request this Chrome actually made. */
  readonly algolia: ReadonlyArray<number>
  readonly cachedGrants: number
  readonly startedAt: number
  readonly endedAt: number
}

const main = async () => {
  const spec = JSON.parse(fs.readFileSync(process.env.SHARD_SPEC ?? "", "utf8")) as ShardSpec
  const startedAt = Date.now()
  let cachedGrants = 0
  const gated = async (address: string) => {
    const { cached } = await acquireVisit(spec.gateUrl, spec.profilePath, address)
    if (cached) cachedGrants += 1
  }

  fs.mkdirSync(SHOTS_PATH, { recursive: true })
  const h = await launch({
    debugPort: spec.debugPort,
    viewport: null,
    profilePath: spec.profilePath
  })
  const traffic = await watchTraffic(
    `http://127.0.0.1:${spec.debugPort}`,
    (url) => url.includes("hn.algolia.com")
  )
  const page = h.context.pages()[0] ?? (await h.context.newPage())

  const aside = await armAndOpenAside(h, page, spec.openers, spec.debugPort, gated)
  if (aside === null) {
    console.error(`shard ${spec.shard}: could not open the in-page panel`)
    process.exit(1)
  }

  const rows: Array<Row & { readonly index: number }> = []
  for (const work of spec.rows) {
    await gated(work.url)
    const seen = await visit(aside, page, work.url)
    const row = work.kind === "reddit-network"
      ? judgeRedditNetwork(seen)
      : judge(work.url, work.expected, seen)
    rows.push({ ...row, index: work.index })
    console.log(rowLine(row))
  }

  // The shots this shard owns — always pages it already swept, so the gate
  // recognises the repeat and the extension's own Lookup Record keeps the
  // revisit off the wire.
  for (const [name, url] of spec.shots) {
    await gated(url)
    const shot = await visit(aside, page, url)
    await page.screenshot({ path: path.join(SHOTS_PATH, `${name}.png`), fullPage: true })
    if (shot.folded > 0) {
      await aside.click(".parle-act-folded")
      await settle(600)
      await page.screenshot({ path: path.join(SHOTS_PATH, `${name}-opened.png`), fullPage: true })
    }
  }

  const result: ShardResult = {
    shard: spec.shard,
    rows,
    algolia: traffic.seen.map((r) => r.at),
    cachedGrants,
    startedAt,
    endedAt: Date.now()
  }
  fs.writeFileSync(spec.outPath, JSON.stringify(result, null, 2))

  traffic.close()
  await h.close()
  process.exit(0)
}

main().catch((error) => {
  console.error("SHARD FAILED:", error)
  process.exit(1)
})
