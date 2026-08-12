#!/usr/bin/env node
/**
 * Run oxlint so the vendored TypeScript plugin loads on Node 22.6–22.17
 * (`--experimental-strip-types`) and on Node 22.18+ / 24+ (native type stripping).
 * CI uses Node 24.
 */
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const oxlintBin = join(root, "node_modules", "oxlint", "bin", "oxlint")

const [major, minor] = process.versions.node.split(".").map(Number)
const nativeTypeStripping = major >= 24 || (major === 22 && minor >= 18)
const env = { ...process.env }
if (!nativeTypeStripping) {
  env.NODE_OPTIONS = [env.NODE_OPTIONS, "--experimental-strip-types"].filter(Boolean).join(" ")
}

const child = spawn(process.execPath, [oxlintBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env
})
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
