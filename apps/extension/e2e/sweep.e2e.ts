/**
 * The front-door sweep, sharded: the SAME corpus, the SAME judgements, across
 * N harnesses at once — each with its own Chrome, its own profile and its own
 * verified X display (`display.ts`), all of them paced by ONE politeness gate
 * (`gate.ts`) because they all share this box's IP and Algolia meters the IP
 * (ADR 0014).
 *
 *   pnpm --filter @parle/extension e2e:sweep          # default 8 shards
 *   SWEEP_SHARDS=16 pnpm --filter @parle/extension e2e:sweep
 *
 * What the coordinator owns, and nothing else:
 *
 *   - Resolving the corpus (`frontdoor.corpus.ts`): the Hacker News front page
 *     is scraped ONCE, here, so every shard measures the same run — and so 16
 *     shards do not fetch the same front page 16 times. `SWEEP_RESOLVED=path`
 *     pins the resolved list to a file, which is how N=1/4/8/16 comparisons
 *     stay comparisons of the runner rather than of the news cycle.
 *   - The partition. Round-robin by corpus order, with one invariant that is
 *     about politeness rather than balance: every occurrence of an address
 *     lands on the shard that saw it first. Profiles do not share Lookup
 *     caches, so a cross-shard repeat would be a real Algolia request the
 *     run-wide LRU could not prevent — co-sharding is what makes "the same
 *     address asked by two scenarios costs one request" true.
 *   - The gate, the displays, and the merged report: one table, the same
 *     right / wrong / nothing-to-judge accounting as the sequential runner,
 *     plus the politeness audit — MEASURED Algolia peak and sustained req/s
 *     from every shard's CDP observer merged, next to what the gate budgeted.
 *
 * The sequential entrypoint (`e2e:frontdoor`) is untouched and remains the
 * one-profile way to run the identical corpus.
 *
 * Since the corpus was widened, the run also carries the page-KIND scenarios
 * (`kinds.corpus.ts`) as one more worker beside the shards — see the note at
 * `KINDS` below for why it is a worker rather than more rows, and
 * `SWEEP_KINDS=0` for the pure front-door run.
 */
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { SHOTS_PATH } from "./harness.ts"
import { acquireDisplay, type OwnedDisplay } from "./display.ts"
import { startGate } from "./gate.ts"
import { ratesOf } from "./traffic.ts"
import { CLASSICS, HN_FRONT, OPENERS, QUIET, REDDIT_NETWORK, REDDIT_SHAPED, SHOTS } from "./frontdoor.corpus.ts"
import { keepLinks, printReport, type Expected, type Row } from "./frontdoor.lib.ts"
import type { ShardResult, ShardSpec } from "./frontdoor.shard.ts"

const here = path.dirname(fileURLToPath(import.meta.url))

const SHARDS = Math.max(1, Number(process.env.SWEEP_SHARDS ?? 8))
const BASE_DISPLAY = Number(process.env.SWEEP_BASE_DISPLAY ?? 120)
const BASE_DEBUG_PORT = Number(process.env.SWEEP_BASE_DEBUG_PORT ?? 9600)
/** The run-wide Algolia budget. ~5 req/s sustained is the ADR 0014 ceiling. */
const RATE = Number(process.env.SWEEP_RATE ?? 5)
const BURST = Number(process.env.SWEEP_BURST ?? 5)
const COST = Number(process.env.SWEEP_COST ?? 2.5)
/**
 * The WIDENED corpus: the page-KIND scenarios (`kinds.corpus.ts`) run beside
 * the front-door shards as one more worker — its own Chrome, profile and
 * display, paying the SAME gate for every navigation, its wire watched by the
 * same kind of CDP observer, its stamps merged into the one politeness audit.
 *
 * It is a worker rather than extra shard rows because a kind scenario is not a
 * URL-with-an-expectation: it serves fixtures, drives clicks, and judges the
 * traffic itself (`kinds.e2e.ts` owns those verdicts). Folding its rows into
 * `frontdoor.shard.ts` would mean a second implementation of that judging, and
 * the two would drift. `SWEEP_KINDS=0` restores the pure front-door sweep so
 * N=1/4/8/16 comparisons stay comparisons of the runner.
 */
const KINDS = (process.env.SWEEP_KINDS ?? "1") !== "0"

interface WorkRow {
  readonly index: number
  readonly url: string
  readonly expected: Expected
  readonly kind?: "reddit-network"
}

const normalise = (address: string): string => address.trim().toLowerCase().replace(/\/+$/, "")

/**
 * The Hacker News front page, without a browser: it is server-rendered HTML,
 * and one fetch of it is cheaper — and politer — than a page-load per run per
 * shard. Entity-decoded because `href` attributes arrive with `&amp;` in them,
 * and `keepLinks` is the same filter the sequential runner applies to `.href`.
 */
const frontPageLinks = async (): Promise<ReadonlyArray<string>> => {
  const html = await (await fetch(HN_FRONT.address)).text()
  const hrefs: Array<string> = []
  const pattern = /<span class="titleline"><a href="([^"]+)"/g
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    hrefs.push(
      match[1]!
        .replaceAll("&amp;", "&")
        .replaceAll("&#x27;", "'")
        .replaceAll("&quot;", '"')
        .replaceAll("&gt;", ">")
        .replaceAll("&lt;", "<")
    )
  }
  return keepLinks(hrefs, HN_FRONT.want, HN_FRONT.skipHosts)
}

/** The whole corpus in the sequential runner's order, each row numbered. */
const resolveCorpus = async (): Promise<ReadonlyArray<WorkRow>> => {
  const pinned = process.env.SWEEP_RESOLVED
  if (pinned !== undefined && fs.existsSync(pinned)) {
    console.log(`corpus: pinned from ${pinned}`)
    return JSON.parse(fs.readFileSync(pinned, "utf8")) as ReadonlyArray<WorkRow>
  }
  const hn = await frontPageLinks()
  console.log(`corpus: ${hn.length} distinct hosts off the Hacker News front page`)
  const rows: Array<WorkRow> = []
  const add = (url: string, expected: Expected, kind?: "reddit-network") =>
    rows.push(kind === undefined
      ? { index: rows.length, url, expected }
      : { index: rows.length, url, expected, kind })
  for (const url of hn) add(url, HN_FRONT.expected)
  add(REDDIT_NETWORK, "quiet", "reddit-network")
  for (const url of REDDIT_SHAPED) add(url, "shows")
  for (const url of QUIET) add(url, "quiet")
  for (const url of CLASSICS) add(url, "shows")
  if (pinned !== undefined) {
    fs.writeFileSync(pinned, JSON.stringify(rows, null, 2))
    console.log(`corpus: pinned to ${pinned}`)
  }
  return rows
}

/**
 * Round-robin, except that a repeated address follows its first occurrence to
 * the same shard — the politeness invariant described at the top of the file.
 */
const partition = (rows: ReadonlyArray<WorkRow>, shards: number): ReadonlyArray<ReadonlyArray<WorkRow>> => {
  const slices: Array<Array<WorkRow>> = Array.from({ length: shards }, () => [])
  const owner = new Map<string, number>()
  let turn = 0
  for (const row of rows) {
    const key = normalise(row.url)
    const claimed = owner.get(key)
    const shard = claimed ?? turn++ % shards
    if (claimed === undefined) owner.set(key, shard)
    slices[shard]!.push(row)
  }
  return slices
}

/** A spec on disk plus where it was written, which is all a child is told. */
type SpawnedSpec = ShardSpec & { readonly specPathForEnv: string }

const runShard = (
  spec: SpawnedSpec,
  display: OwnedDisplay,
  tsx: { readonly command: string; readonly prefixArgs: ReadonlyArray<string> }
): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(
      tsx.command,
      [...tsx.prefixArgs, path.join(here, "frontdoor.shard.ts")],
      {
        cwd: path.resolve(here, ".."),
        env: { ...process.env, DISPLAY: display.name, SHARD_SPEC: spec.specPathForEnv }
      }
    )
    const forward = (stream: NodeJS.ReadableStream) => {
      let buffered = ""
      stream.on("data", (chunk: Buffer) => {
        buffered += chunk.toString()
        for (let cut = buffered.indexOf("\n"); cut >= 0; cut = buffered.indexOf("\n")) {
          const line = buffered.slice(0, cut)
          buffered = buffered.slice(cut + 1)
          if (line.trim() !== "") console.log(`[s${spec.shard}] ${line}`)
        }
      })
    }
    forward(child.stdout)
    forward(child.stderr)
    child.once("exit", (code) => resolve(code ?? 1))
  })

/** What the kinds worker wrote for the coordinator: verdicts plus raw stamps. */
interface KindsReport {
  readonly rows: ReadonlyArray<{
    readonly id: string
    readonly kind: string
    readonly verdict: "ok" | "WRONG" | "note"
    readonly actual: string
    readonly failed: ReadonlyArray<string>
    readonly detail: string
  }>
  readonly stamps?: ReadonlyArray<number>
}

const runKinds = (
  display: OwnedDisplay,
  gateUrl: string,
  outPath: string,
  tsx: { readonly command: string; readonly prefixArgs: ReadonlyArray<string> }
): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(
      tsx.command,
      [...tsx.prefixArgs, path.join(here, "kinds.e2e.ts")],
      {
        cwd: path.resolve(here, ".."),
        env: { ...process.env, DISPLAY: display.name, SWEEP_GATE_URL: gateUrl, KINDS_OUT: outPath }
      }
    )
    const forward = (stream: NodeJS.ReadableStream) => {
      let buffered = ""
      stream.on("data", (chunk: Buffer) => {
        buffered += chunk.toString()
        for (let cut = buffered.indexOf("\n"); cut >= 0; cut = buffered.indexOf("\n")) {
          const line = buffered.slice(0, cut)
          buffered = buffered.slice(cut + 1)
          if (line.trim() !== "") console.log(`[kinds] ${line}`)
        }
      })
    }
    forward(child.stdout)
    forward(child.stderr)
    child.once("exit", (code) => resolve(code ?? 1))
  })

const main = async () => {
  const startedAt = Date.now()
  const corpus = await resolveCorpus()
  const shardCount = Math.min(SHARDS, corpus.length)
  const slices = partition(corpus, shardCount)

  const runDir = path.resolve(SHOTS_PATH, "../.e2e-sweep")
  fs.rmSync(runDir, { recursive: true, force: true })
  fs.mkdirSync(runDir, { recursive: true })
  fs.mkdirSync(SHOTS_PATH, { recursive: true })

  const gate = await startGate({ requestsPerSecond: RATE, burst: BURST, costPerPage: COST })
  const displays = await Promise.all(
    Array.from({ length: shardCount + (KINDS ? 1 : 0) }, (_, i) => acquireDisplay(BASE_DISPLAY + i))
  )
  console.log(
    `${shardCount} shard(s)${KINDS ? " + the page-KIND worker" : ""} on ` +
      `${displays.map((d) => d.name).join(" ")}, ` +
      `gate ${RATE} req/s (burst ${BURST}, ${COST}/page) at ${gate.url}\n`
  )

  const require_ = createRequire(import.meta.url)
  let tsx: { command: string; prefixArgs: ReadonlyArray<string> }
  try {
    tsx = { command: process.execPath, prefixArgs: [require_.resolve("tsx/cli")] }
  } catch {
    tsx = { command: "tsx", prefixArgs: [] }
  }

  const shotOwner = (url: string): number => {
    const key = normalise(url)
    for (let i = 0; i < shardCount; i += 1) {
      if (slices[i]!.some((row) => normalise(row.url) === key)) return i
    }
    return 0
  }

  const specs = slices.map((slice, i): SpawnedSpec => {
    const spec: ShardSpec = {
      shard: i,
      debugPort: BASE_DEBUG_PORT + i,
      profilePath: path.resolve(SHOTS_PATH, `../.e2e-profile-sweep-${i}`),
      gateUrl: gate.url,
      openers: OPENERS,
      rows: slice,
      shots: SHOTS.filter(([, url]) => shotOwner(url) === i),
      outPath: path.join(runDir, `shard-${i}.out.json`)
    }
    const specPath = path.join(runDir, `shard-${i}.spec.json`)
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2))
    return { ...spec, specPathForEnv: specPath }
  })

  const shardsAt = Date.now()
  const kindsOut = path.join(runDir, "kinds.out.json")
  const [codes, kindsCode] = await Promise.all([
    Promise.all(specs.map((spec, i) => runShard(spec, displays[i]!, tsx))),
    KINDS ? runKinds(displays[shardCount]!, gate.url, kindsOut, tsx) : Promise.resolve(0)
  ])
  const shardsWall = (Date.now() - shardsAt) / 1000

  await Promise.all(displays.map((d) => d.stop()))
  await gate.close()

  // The merge: one table in corpus order, the sequential runner's accounting.
  const results: Array<ShardResult> = []
  const dead: Array<number> = []
  for (const spec of specs) {
    if (codes[spec.shard] === 0 && fs.existsSync(spec.outPath)) {
      results.push(JSON.parse(fs.readFileSync(spec.outPath, "utf8")) as ShardResult)
    } else {
      dead.push(spec.shard)
    }
  }
  const merged: Array<Row & { readonly index: number }> = results
    .flatMap((r) => [...r.rows])
    .sort((a, b) => a.index - b.index)
  printReport(merged)

  // The kinds worker's half of the widened corpus, and its share of the wire.
  const kinds: KindsReport | null = KINDS && kindsCode === 0 && fs.existsSync(kindsOut)
    ? (JSON.parse(fs.readFileSync(kindsOut, "utf8")) as KindsReport)
    : null
  const kindsDied = KINDS && kinds === null
  const kindsWrong = (kinds?.rows ?? []).filter((r) => r.verdict === "WRONG")
  const kindsNotes = (kinds?.rows ?? []).filter((r) => r.verdict === "note")
  if (kinds !== null) {
    console.log(`\n=== The page kinds (same gate, own worker) ===\n`)
    for (const row of kinds.rows) {
      console.log(
        `  ${row.verdict === "ok" ? "ok   " : row.verdict === "note" ? "note " : "WRONG"} ` +
          `${row.kind.padEnd(16)} ${row.actual.padEnd(24)} ${row.id}` +
          (row.detail === "" ? "" : ` — ${row.detail}`)
      )
      for (const miss of row.failed) console.log(`           failed: ${miss}`)
    }
    console.log(
      `\n${kinds.rows.length - kindsWrong.length - kindsNotes.length}/${kinds.rows.length} as expected, ` +
        `${kindsWrong.length} wrong, ${kindsNotes.length} not measured`
    )
  }

  const stamps = [
    ...results.flatMap((r) => [...r.algolia]),
    ...(kinds?.stamps ?? [])
  ]
  const rates = ratesOf(stamps)
  const cachedGrants = results.reduce((sum, r) => sum + r.cachedGrants, 0)
  const totalWall = (Date.now() - startedAt) / 1000
  console.log(
    `\n=== The run ===\n` +
      `shards:            ${shardCount} (${results.length} completed${dead.length > 0 ? `, DIED: ${dead.join(", ")}` : ""})` +
      `${KINDS ? ` + kinds worker${kindsDied ? " (DIED)" : ""}` : ""}\n` +
      `wall:              ${totalWall.toFixed(1)}s total, ${shardsWall.toFixed(1)}s in shards\n` +
      `pages measured:    ${merged.length}/${corpus.length} front doors` +
      `${kinds === null ? "" : ` + ${kinds.rows.length} kind scenario(s)`}\n` +
      `algolia requests:  ${rates.total} measured on the wire (every worker merged)\n` +
      `algolia peak:      ${rates.peakPerSecond} req/s (worst one-second window)\n` +
      `algolia sustained: ${rates.sustainedPerSecond} req/s (budget ${RATE})\n` +
      `repeat visits:     ${cachedGrants} granted off the run's LRU, zero requests`
  )

  fs.writeFileSync(path.join(SHOTS_PATH, "frontdoor-sweep.json"), JSON.stringify(merged, null, 2))
  fs.writeFileSync(
    path.join(runDir, "run.json"),
    JSON.stringify(
      {
        shards: shardCount,
        dead,
        kinds: KINDS ? { code: kindsCode, rows: kinds?.rows ?? null } : null,
        totalWallSeconds: totalWall,
        shardsWallSeconds: shardsWall,
        rates,
        cachedGrants,
        rows: merged
      },
      null,
      2
    )
  )
  process.exit(dead.length > 0 || kindsDied ? 1 : 0)
}

main().catch((error) => {
  console.error("SWEEP FAILED:", error)
  process.exit(1)
})
