#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const loadedFlag = "--turbo-env-loaded"
const argumentsWithoutFlag = process.argv.slice(2).filter((argument) => argument !== loadedFlag)
const configHome = process.env["XDG_CONFIG_HOME"] || resolve(homedir(), ".config")
const cacheHome = process.env["XDG_CACHE_HOME"] || resolve(homedir(), ".cache")
const turboEnvironment = resolve(configHome, "gitstart", "turbo.env")
const allowUncached = process.env["PARLE_ALLOW_UNCACHED_CI"] === "1"

const exitFrom = (result: ReturnType<typeof spawnSync>): never => {
  if (result.error !== undefined) {
    console.error(result.error.message)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

if (!process.env["TURBO_TOKEN"] && !process.argv.includes(loadedFlag) && existsSync(turboEnvironment)) {
  exitFrom(
    spawnSync(
      "op",
      [
        "run",
        `--env-file=${turboEnvironment}`,
        "--",
        process.execPath,
        fileURLToPath(import.meta.url),
        loadedFlag,
        ...argumentsWithoutFlag
      ],
      { stdio: "inherit", windowsHide: true }
    )
  )
}

if (!process.env["TURBO_TOKEN"] && !allowUncached) {
  console.error(
    [
      "Local CI has no TURBO_TOKEN, so it cannot use the shared GitStart cache.",
      `Export TURBO_TOKEN directly or create ${turboEnvironment} with a 1Password reference.`,
      "Set PARLE_ALLOW_UNCACHED_CI=1 only when a full uncached run is intentional."
    ].join("\n")
  )
  process.exit(1)
}

if (!process.env["TURBO_TOKEN"]) {
  console.warn("Local CI is running without the shared Turbo cache by explicit request.")
}

const launcher = fileURLToPath(import.meta.resolve("run-local-ci/native-launcher"))
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  LOCAL_CI_WORKING_DIR:
    process.env["LOCAL_CI_WORKING_DIR"] || resolve(cacheHome, "parle-local-ci"),
  TURBO_REMOTE_CACHE_ENABLED: process.env["TURBO_REMOTE_CACHE_ENABLED"] || "true",
  TURBO_TEAM: "gitstart"
}

if (!process.env["TURBO_TOKEN"]) {
  // Local CI validates every secrets.* reference before it starts. Supply a
  // non-secret sentinel only for the explicit uncached path, then disable the
  // remote client so Turbo never sends that sentinel to Vercel.
  childEnvironment["TURBO_TOKEN"] = "uncached-local-ci"
  childEnvironment["TURBO_REMOTE_CACHE_ENABLED"] = "false"
}

exitFrom(
  spawnSync(
    process.execPath,
    [
      launcher,
      "run",
      "--workflow",
      ".github/workflows/local-ci.yml",
      "--jobs",
      "2",
      "--prewarm-through",
      ".github/workflows/local-ci.yml:quality:install",
      "--pause-on-failure",
      ...argumentsWithoutFlag
    ],
    { env: childEnvironment, stdio: "inherit", windowsHide: true }
  )
)
