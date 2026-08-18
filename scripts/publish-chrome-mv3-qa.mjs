#!/usr/bin/env node

/**
 * Stage — and optionally publish — the durable Chrome MV3 QA zip.
 *
 * Humans and CI use the same path. The zip is never committed to main; `--push`
 * updates `qa/chrome-mv3-latest` (an artifact branch, not a source branch).
 *
 *   node scripts/publish-chrome-mv3-qa.mjs <zip|dir> [--dest dist-qa]
 *   node scripts/publish-chrome-mv3-qa.mjs <zip> --push
 *   node scripts/publish-chrome-mv3-qa.mjs --push --dest dist-qa
 */

import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

const ZIP_NAME = "parle-chrome-mv3.zip"
const BUILD_NAME = "BUILD.txt"
const DEFAULT_BRANCH = "qa/chrome-mv3-latest"
const BUILD_COMMAND = "pnpm --filter @parle/extension exec wxt zip"

const fail = (message) => {
  console.error(`publish-chrome-mv3-qa: ${message}`)
  process.exit(1)
}

const usage = () => {
  fail(
    "usage: node scripts/publish-chrome-mv3-qa.mjs [<zip>] [--dest dist-qa] [--push] [--commit <sha>] [--branch qa/chrome-mv3-latest]"
  )
}

const repoRoot = () => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()
  } catch {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..")
  }
}

const parseArgs = (argv) => {
  const options = {
    zip: undefined,
    dest: undefined,
    push: false,
    commit: process.env.QA_SOURCE_SHA || process.env.GITHUB_SHA,
    branch: process.env.QA_BRANCH || DEFAULT_BRANCH
  }

  const take = (flag, i) => {
    const value = argv[i + 1]
    if (!value || value.startsWith("-")) fail(`${flag} needs a value`)
    return value
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--push") options.push = true
    else if (arg === "--dest") options.dest = take(arg, i++)
    else if (arg === "--commit") options.commit = take(arg, i++)
    else if (arg === "--branch") options.branch = take(arg, i++)
    else if (arg.startsWith("-")) usage()
    else if (!options.zip) options.zip = arg
    else usage()
  }

  return options
}

const redact = (text) =>
  String(text).replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@").replace(/\/\/[^/\s:]+:[^@\s]+@/g, "//***@")

const run = (command, args, extra = {}) => {
  try {
    return execFileSync(command, args, { encoding: "utf8", ...extra }).trim()
  } catch (error) {
    const detail = redact(error.stderr || error.message)
    throw new Error(`${command} ${args[0] ?? ""} failed: ${detail}`)
  }
}

const tryRun = (command, args) => {
  try {
    return run(command, args)
  } catch {
    return undefined
  }
}

const auditZip = (archive, root) => {
  const checker = join(root, "store/check-release.mjs")
  try {
    execFileSync(process.execPath, [checker, archive], { stdio: "inherit" })
  } catch {
    fail(`store audit rejected ${archive}`)
  }
}

const zipMeta = (archive) => {
  try {
    const entries = run("unzip", ["-Z1", archive]).split("\n").filter(Boolean)
    const manifest = JSON.parse(run("unzip", ["-p", archive, "manifest.json"]))
    if (!manifest.version) fail("manifest.json has no version")
    return { entries, manifest }
  } catch (error) {
    fail(`cannot read ${archive}: ${error.message}`)
  }
}

const resolveCommit = (root, commit) => {
  if (commit) return commit
  const sha = tryRun("git", ["-C", root, "rev-parse", "HEAD"])
  if (!sha) fail("could not determine source commit; pass --commit")
  return sha
}

const nodeVersion = () => process.env.QA_NODE_VERSION || process.version

const pnpmVersion = () => {
  if (process.env.QA_PNPM_VERSION) return process.env.QA_PNPM_VERSION
  return tryRun("pnpm", ["-v"]) ?? "9.12.0"
}

const writeBuildTxt = ({ dest, commit, version, sha256, files }) => {
  const lines = [
    "Parle Chrome MV3 QA package",
    "",
    `commit: ${commit}`,
    `package_version: ${version}`,
    `node: ${nodeVersion()}`,
    `pnpm: ${pnpmVersion()}`,
    `timestamp: ${new Date().toISOString()}`,
    `command: ${BUILD_COMMAND}`,
    `zip: ${ZIP_NAME}`,
    `sha256: ${sha256}`,
    `files: ${files}`,
    ""
  ]
  writeFileSync(join(dest, BUILD_NAME), lines.join("\n"))
}

const stage = ({ zip, dest, commit, root }) => {
  auditZip(zip, root)
  mkdirSync(dest, { recursive: true })
  const target = join(dest, ZIP_NAME)
  copyFileSync(zip, target)
  const { entries, manifest } = zipMeta(target)
  const sha256 = createHash("sha256").update(readFileSync(target)).digest("hex")
  const source = resolveCommit(root, commit)
  writeBuildTxt({ dest, commit: source, version: manifest.version, sha256, files: entries.length })
  console.log(`staged ${target} · MV${manifest.manifest_version} · v${manifest.version} · ${entries.length} files`)
  console.log(`wrote ${join(dest, BUILD_NAME)} · commit ${source}`)
  return { target, version: manifest.version, commit: source }
}

const pushRemote = (root) => {
  if (process.env.QA_PUSH_REMOTE) return process.env.QA_PUSH_REMOTE
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    return `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`
  }
  const origin = tryRun("git", ["-C", root, "remote", "get-url", "origin"])
  if (!origin) fail("no git remote; set QA_PUSH_REMOTE or GITHUB_TOKEN + GITHUB_REPOSITORY")
  return origin
}

const gitIdentity = (root) => {
  if (process.env.GITHUB_ACTIONS === "true") {
    return {
      name: process.env.GIT_AUTHOR_NAME || "github-actions[bot]",
      email: process.env.GIT_AUTHOR_EMAIL || "41898282+github-actions[bot]@users.noreply.github.com"
    }
  }
  return {
    name: tryRun("git", ["-C", root, "config", "user.name"]) || "parle-qa",
    email: tryRun("git", ["-C", root, "config", "user.email"]) || "parle-qa@users.noreply.github.com"
  }
}

const remoteHasBranch = (remote, branch) => {
  const refs = run("git", ["ls-remote", "--heads", remote, branch])
  return refs.length > 0
}

const pushBranch = ({ dest, branch, root, version, commit }) => {
  const zip = join(dest, ZIP_NAME)
  const build = join(dest, BUILD_NAME)
  try {
    readFileSync(zip)
    readFileSync(build)
  } catch {
    fail(`${dest} must contain ${ZIP_NAME} and ${BUILD_NAME} before --push`)
  }

  const remote = pushRemote(root)
  const identity = gitIdentity(root)
  const work = mkdtempSync(join(tmpdir(), "parle-qa-zip-"))

  try {
    if (remoteHasBranch(remote, branch)) {
      run("git", ["clone", "--branch", branch, "--single-branch", "--depth", "1", remote, work], {
        stdio: "pipe"
      })
    } else {
      run("git", ["init", "-b", branch, work])
      run("git", ["-C", work, "remote", "add", "origin", remote])
    }

    run("git", ["-C", work, "config", "user.name", identity.name])
    run("git", ["-C", work, "config", "user.email", identity.email])

    copyFileSync(zip, join(work, ZIP_NAME))
    copyFileSync(build, join(work, BUILD_NAME))
    run("git", ["-C", work, "add", ZIP_NAME, BUILD_NAME])

    const dirty = tryRun("git", ["-C", work, "status", "--porcelain"])
    if (!dirty) {
      console.log(`${branch} already has this zip and BUILD.txt`)
      return
    }

    const message = `qa: chrome mv3 ${commit.slice(0, 12)} (${version})`
    run("git", ["-C", work, "commit", "-m", message])
    run("git", ["-C", work, "push", "origin", `HEAD:${branch}`])
    console.log(`published ${ZIP_NAME} and ${BUILD_NAME} to ${branch}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const options = parseArgs(process.argv.slice(2))
const root = repoRoot()
const dest = resolve(root, options.dest || "dist-qa")

if (!options.zip && !options.push) usage()

/**
 * A directory is accepted as well as a file, matching `store/check-release.mjs`
 * and `store/cws.mjs`.
 *
 * `wxt zip` names its artifact from the package version, so the path moves on
 * every bump; callers that hard-coded it are how the repository spent a while
 * auditing a `0.0.0` zip while shipping a `3.0.1` one. Exactly one match is
 * required — two means a stale build survived a bump, and silently picking one
 * is how the wrong artifact reaches the QA branch.
 */
const resolveArchive = (target) => {
  const path = resolve(target)
  let directory = false
  try {
    directory = statSync(path).isDirectory()
  } catch {
    fail(`zip not found: ${path}`)
  }
  if (!directory) return path

  const zips = readdirSync(path).filter((name) => name.endsWith("-chrome.zip")).sort()
  if (zips.length === 0) fail(`no *-chrome.zip in ${path} — run \`${BUILD_COMMAND}\` first`)
  if (zips.length > 1) fail(`${zips.length} zips in ${path} (${zips.join(", ")}) — clear the stale ones`)
  return join(path, zips[0])
}

let staged
if (options.zip) {
  staged = stage({ zip: resolveArchive(options.zip), dest, commit: options.commit, root })
}

if (options.push) {
  auditZip(join(dest, ZIP_NAME), root)
  const build = readFileSync(join(dest, BUILD_NAME), "utf8")
  const version = staged?.version ?? /package_version: (\S+)/.exec(build)?.[1]
  const commit = staged?.commit ?? /commit: (\S+)/.exec(build)?.[1]
  if (!version || !commit) fail(`${BUILD_NAME} is missing package_version or commit`)
  pushBranch({ dest, branch: options.branch, root, version, commit })
}
