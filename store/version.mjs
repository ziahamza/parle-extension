#!/usr/bin/env node

/**
 * The one place that knows what version the extension is.
 *
 * `apps/extension/package.json`'s `version` is the source of truth: WXT copies
 * it into the manifest and into the name of the zip it writes. Nothing else in
 * the repository writes a version down, and this script exists so that nothing
 * has to — CI reads it, the release workflow compares against it, and a human
 * bumping it does so through `--set` rather than by editing JSON by hand.
 *
 *   node store/version.mjs              → prints the current version
 *   node store/version.mjs --set 3.0.2  → writes it, then prints it
 *   node store/version.mjs --set patch  → 3.0.1 → 3.0.2
 *   node store/version.mjs --set minor  → 3.0.1 → 3.1.0
 *   node store/version.mjs --set major  → 3.0.1 → 4.0.0
 *
 * The Chrome Web Store requires every upload to be strictly greater than the
 * version already on the item, and it rejects the upload outright otherwise —
 * so `--set` refuses to move backwards or sideways. That check is here rather
 * than in the workflow because a bump that is wrong is better caught on the
 * machine of the person making it than in a job that has already built.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const manifestPath = join(root, "apps", "extension", "package.json")

/**
 * Chrome's version grammar, not semver's: one to four dot-separated integers,
 * each 0–65535, no leading zeros, no pre-release or build suffix. A `3.0.1-rc1`
 * is a perfectly good npm version and an instant rejection at the store, so it
 * is refused here where the error is cheap.
 */
const CHROME_VERSION = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/

const parse = (version) => {
  if (!CHROME_VERSION.test(version)) return undefined
  const parts = version.split(".").map(Number)
  if (parts.some((part) => part > 65535)) return undefined
  return parts
}

/** -1, 0 or 1. Shorter versions are zero-padded: `3.0` and `3.0.0` are equal. */
export const compareVersions = (left, right) => {
  const a = left.split(".").map(Number)
  const b = right.split(".").map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  return 0
}

export const readVersion = () => JSON.parse(readFileSync(manifestPath, "utf8")).version

const writeVersion = (version) => {
  // Rewritten as text rather than re-serialised, so the file keeps its own key
  // order, indentation and trailing newline instead of being reformatted by a
  // release script that has no business touching anything but this one field.
  const source = readFileSync(manifestPath, "utf8")
  const next = source.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`)
  if (next === source) throw new Error(`could not find a version field in ${manifestPath}`)
  writeFileSync(manifestPath, next)
}

const bump = (current, step) => {
  const parts = parse(current)
  if (!parts) throw new Error(`current version is not a Chrome version: ${current}`)
  const [major = 0, minor = 0, patch = 0] = parts
  if (step === "major") return `${major + 1}.0.0`
  if (step === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const main = () => {
  const args = process.argv.slice(2)
  const setIndex = args.indexOf("--set")

  if (setIndex === -1) {
    process.stdout.write(`${readVersion()}\n`)
    return
  }

  const requested = args[setIndex + 1]
  if (!requested) throw new Error("--set needs a version, or one of: major, minor, patch")

  const current = readVersion()
  const next = ["major", "minor", "patch"].includes(requested) ? bump(current, requested) : requested

  if (!parse(next)) {
    throw new Error(
      `not a Chrome version: ${next}. One to four integers 0-65535, dot separated, ` +
        "no leading zeros and no -rc/+build suffix — the store rejects those on upload."
    )
  }
  if (compareVersions(next, current) <= 0) {
    throw new Error(
      `${next} is not greater than the current ${current}. The Chrome Web Store rejects ` +
        "an upload whose version is not strictly higher than the one already on the item."
    )
  }

  writeVersion(next)
  process.stdout.write(`${next}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`version: ${error.message}`)
    process.exit(1)
  }
}
