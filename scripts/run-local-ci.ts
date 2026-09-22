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
const turboAPI = process.env["TURBO_API"]
const turboTeam = process.env["TURBO_TEAM"] || "gitstart"

// Local CI runs bridged containers, not host processes. A host daemon's
// loopback endpoint cannot be reached there and must not fall back to Vercel.
if (turboAPI && process.env["TURBO_TOKEN"]) {
  let endpoint: URL
  try {
    endpoint = new URL(turboAPI)
  } catch {
    console.error("TURBO_API must be a valid container-reachable cache URL.")
    process.exit(1)
  }
  if (["localhost", "[::1]"].includes(endpoint.hostname) || endpoint.hostname.startsWith("127.")) {
    console.error(
      "Local CI containers cannot reach the host's loopback cache. Use layercache run --config ~/.config/layercache/parle.json -- pnpm ci:quality for host builds, or configure a container-reachable cache route."
    )
    process.exit(1)
  }
  if (!process.env["TURBO_TEAM"]) {
    console.error("Set TURBO_TEAM explicitly when using a custom TURBO_API.")
    process.exit(1)
  }
}

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
      "Local CI has no TURBO_TOKEN, so it cannot use a shared remote cache.",
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
  TURBO_TEAM: turboTeam
}

if (!process.env["TURBO_TOKEN"]) {
  // Local CI validates every secrets.* reference before it starts. Supply a
  // non-secret sentinel only for the explicit uncached path. Restrict Turbo
  // to its local cache so it never sends that sentinel to Vercel.
  childEnvironment["TURBO_TOKEN"] = "uncached-local-ci"
  childEnvironment["TURBO_CACHE"] = "local:rw"
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
      "--var",
      `TURBO_TEAM=${turboTeam}`,
      "--var",
      // Local CI requires nonempty referenced variables even though Turbo
      // itself accepts an empty API as its Vercel default. Uncached mode
      // still disables remote access through TURBO_CACHE=local:rw.
      `TURBO_API=${process.env["TURBO_TOKEN"] && turboAPI ? turboAPI : "https://vercel.com/api"}`,
      "--var",
      `TURBO_CACHE=${childEnvironment["TURBO_CACHE"] || "local:rw,remote:rw"}`,
      ...argumentsWithoutFlag
    ],
    { env: childEnvironment, stdio: "inherit", windowsHide: true }
  )
)
