#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { basename, dirname, join } from "node:path"

const [target, screenshots] = process.argv.slice(2)

const fail = (message: string) => {
  console.error(`release audit: ${message}`)
  process.exitCode = 1
}

if (!target) {
  fail("pass the Chrome zip — or the directory holding it — as the first argument")
  process.exit()
}

/**
 * Accept a directory as well as a file.
 *
 * `wxt zip` names its artifact from the package version, so the path is
 * `parleextension-<version>-chrome.zip` and it MOVES every time the version is
 * bumped. Callers used to hard-code it, which is how the repository ended up
 * auditing a stale `0.0.0` zip while shipping a `3.0.1` one. Point this at
 * `apps/extension/.output` instead and the audit follows the build.
 *
 * Exactly one match is required. Two means an older build is still sitting in
 * `.output/` — and picking either one silently is how the wrong artifact gets
 * uploaded, which is the specific accident this whole file exists to prevent.
 */
const resolveArchive = (path: string) => {
  let directory = false
  try {
    directory = statSync(path).isDirectory()
  } catch {
    fail(`no such path: ${path}`)
    process.exit()
  }
  if (!directory) return path

  const zips = readdirSync(path).filter((name) => /^.+-chrome\.zip$/.test(name)).sort()
  if (zips.length === 0) {
    fail(`no *-chrome.zip in ${path} — run \`wxt zip\` first`)
    process.exit()
  }
  if (zips.length > 1) {
    fail(`${zips.length} candidate zips in ${path} (${zips.join(", ")}) — clear the stale ones`)
    process.exit()
  }
  return join(path, zips[0] as string)
}

const archive = resolveArchive(target)

let entries = []
let manifest
try {
  entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
} catch (error) {
  fail(`cannot inspect ${archive}: ${(error as Error).message}`)
  process.exit()
}

/**
 * Placement is judged from the LISTING, before anything is read out of the
 * archive.
 *
 * These two checks used to sit after `unzip -p manifest.json`, which meant the
 * one shape they exist to name — everything nested under `chrome-mv3/`, which
 * the store rejects with "manifest file is missing or unreadable" — died on the
 * unzip instead, as `cannot inspect …: Command failed`. The archive was still
 * refused, so nothing unsafe shipped; the person reading the failure was simply
 * told the wrong thing about a mistake that has a known cause and a known fix.
 * `scripts/publish-chrome-mv3-qa.ts` delegates here, so it inherited the same
 * misleading message.
 */
if (!entries.includes("manifest.json")) fail("manifest.json is not at the zip root")
if (entries.some((entry) => entry.startsWith("chrome-mv3/"))) {
  fail("zip has an extra chrome-mv3 directory — never `zip -r` the output folder, use `wxt zip`")
}
if (process.exitCode) process.exit(process.exitCode)

try {
  manifest = JSON.parse(execFileSync("unzip", ["-p", archive, "manifest.json"], { encoding: "utf8" }))
} catch (error) {
  fail(`cannot read manifest.json from ${archive}: ${(error as Error).message}`)
  process.exit()
}

if (entries.some((entry) => entry.endsWith(".map"))) fail("source maps are present")
if ("key" in manifest) fail("manifest contains a pinned extension key")
if (manifest.manifest_version !== 3) fail(`expected Manifest V3, got ${manifest.manifest_version}`)
if (manifest.name !== "Parle") fail(`expected Parle, got ${manifest.name}`)

/**
 * The expected permissions come from `store/listing.json`, not from a literal
 * here, because they are also what the Privacy tab justifies one by one. A build
 * that stops asking for something must drop its justification in the same
 * change, and a build that starts asking for something new must gain one — so
 * there is a single list, and this audit is what fails until it is updated.
 */
const listing = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "listing.json"), "utf8"))

const expectedPermissions = [...listing.permissions].sort()
const permissions = [...(manifest.permissions ?? [])].sort()
if (JSON.stringify(permissions) !== JSON.stringify(expectedPermissions)) {
  fail(
    `permissions are ${JSON.stringify(permissions)}, listing.json says ${JSON.stringify(expectedPermissions)}. ` +
      "Update listing.json and the justification in LISTING.md §2.2 together."
  )
}

const expectedHosts = [...listing.hostPermissions].sort()
const hosts = [...(manifest.host_permissions ?? [])].sort()
if (JSON.stringify(hosts) !== JSON.stringify(expectedHosts)) {
  fail(`host permissions are ${JSON.stringify(hosts)}, listing.json says ${JSON.stringify(expectedHosts)}`)
}

console.log(`package: ${basename(archive)} · MV${manifest.manifest_version} · v${manifest.version} · ${entries.length} files`)

if (screenshots) {
  const files = readdirSync(screenshots).filter((name) => name.endsWith(".png")).sort()
  if (files.length !== 5) fail(`expected 5 screenshots, found ${files.length}`)
  files.forEach((name, index) => {
    const bytes = readFileSync(join(screenshots, name))
    const png = bytes.length >= 26 && bytes.toString("ascii", 1, 4) === "PNG"
    const width = png ? bytes.readUInt32BE(16) : 0
    const height = png ? bytes.readUInt32BE(20) : 0
    const colorType = png ? bytes[25] : -1
    if (!name.startsWith(`0${index + 1}-`)) fail(`screenshot order is not 01..05: ${name}`)
    if (width !== 1280 || height !== 800) fail(`${name} is ${width}x${height}, expected 1280x800`)
    if (colorType === 4 || colorType === 6) fail(`${name} has an alpha channel`)
    console.log(`screenshot: ${name} · ${width}x${height} · color type ${colorType}`)
  })
}

if (process.exitCode) process.exit(process.exitCode)
console.log("release audit: passed")
