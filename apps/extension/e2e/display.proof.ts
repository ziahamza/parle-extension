/**
 * The proof that the display race is gone: N real harness launches AT ONCE,
 * each on a display `display.ts` allocated, each required to come up LISTENING.
 *
 * This is the exact failure `xvfb-run -a` showed at 24-way — two runs lost to
 * "Missing X server or $DISPLAY" — replayed against the fix. Every child is a
 * separate process (as sweep shards are), every launch goes through the real
 * `harness.ts` (so "clean" means the worker registered listeners, not merely
 * that Chrome started), and the pass condition is all-or-nothing.
 *
 *   tsx e2e/display.proof.ts [n]        # parent: default 24
 *   tsx e2e/display.proof.ts child      # one launch on $DISPLAY, then exit
 */
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { acquireDisplay, type OwnedDisplay } from "./display.ts"

const BASE_DISPLAY = 120

const child = async () => {
  const { launch } = await import("./harness.ts")
  const h = await launch({ profilePath: process.env.PROOF_PROFILE })
  await h.close()
  console.log(`ok display=${process.env.DISPLAY} extension=${h.extensionId}`)
}

const parent = async (n: number) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "parle-display-proof-"))
  const startedAt = Date.now()

  // Concurrently on purpose: allocation must survive being raced, not merely
  // work when called politely one at a time.
  const displays = await Promise.all(
    Array.from({ length: n }, (_, i) => acquireDisplay(BASE_DISPLAY + i))
  )
  console.log(`allocated ${displays.map((d) => d.name).join(" ")}`)

  const runOne = (display: OwnedDisplay, i: number) =>
    new Promise<{ readonly i: number; readonly code: number; readonly out: string }>((resolve) => {
      const proc = spawn("tsx", [path.join(import.meta.dirname, "display.proof.ts"), "child"], {
        env: {
          ...process.env,
          DISPLAY: display.name,
          PROOF_PROFILE: path.join(scratch, `profile-${i}`)
        }
      })
      let out = ""
      proc.stdout.on("data", (d: Buffer) => (out += d.toString()))
      proc.stderr.on("data", (d: Buffer) => (out += d.toString()))
      proc.once("exit", (code) => resolve({ i, code: code ?? 1, out }))
    })

  const results = await Promise.all(displays.map(runOne))
  await Promise.all(displays.map((d) => d.stop()))
  fs.rmSync(scratch, { recursive: true, force: true })

  const failed = results.filter((r) => r.code !== 0)
  for (const r of results) {
    console.log(`  shard ${String(r.i).padStart(2)} ${r.code === 0 ? "ok" : "FAILED"} ${r.out.trim().split("\n")[0] ?? ""}`)
  }
  console.log(
    `${n - failed.length}/${n} launches clean in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  )
  for (const r of failed) console.error(`--- shard ${r.i} ---\n${r.out}`)
  process.exit(failed.length === 0 ? 0 : 1)
}

if (process.argv[2] === "child") {
  child().catch((error) => {
    console.error(error)
    process.exit(1)
  })
} else {
  parent(Number(process.argv[2] ?? 24)).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
