#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { arch, hostname, platform } from "node:os"

const turboArguments = process.argv.slice(2)

if (turboArguments.length === 0) {
  console.error("Usage: node scripts/run-turbo-ci.ts <turbo arguments>")
  process.exit(1)
}

const nodeMajor = process.versions.node.split(".", 1)[0] ?? process.versions.node
const runtime =
  process.env["PARLE_CI_RUNTIME"] ||
  (hostname() === "hzia-box-eu" &&
  platform() === "linux" &&
  arch() === "x64" &&
  nodeMajor === "24"
    ? "Linux-X64-node24-pnpm9.12.0"
    : `local-${platform()}-${arch()}-node${nodeMajor}-pnpm9.12.0`)
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const result = spawnSync(pnpm, ["exec", "turbo", ...turboArguments], {
  env: { ...process.env, PARLE_CI_RUNTIME: runtime },
  stdio: "inherit",
  windowsHide: true
})

if (result.error !== undefined) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
