#!/usr/bin/env node

/**
 * Stage — and optionally publish — the durable Chrome MV3 QA zip.
 *
 * Humans and CI use the same path. The zip is never committed to main; `--push`
 * updates `qa/chrome-mv3-latest` (an artifact branch, not a source branch).
 *
 *   node scripts/publish-chrome-mv3-qa.ts <zip|dir> [--dest dist-qa]
 *   node scripts/publish-chrome-mv3-qa.ts <zip> --push
 *   node scripts/publish-chrome-mv3-qa.ts --push --dest dist-qa
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

const fail: (message: string) => never = (message) => {
  console.error(`publish-chrome-mv3-qa: ${message}`)
  process.exit(1)
}

const usage: () => never = () =>
  fail(
    "usage: node scripts/publish-chrome-mv3-qa.ts [<zip|dir>] [--dest dist-qa] [--push] [--commit <sha>] [--branch qa/chrome-mv3-latest]"
  )

const repoRoot = (): string => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()
  } catch {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..")
  }
}

interface Options {
  zip: string | undefined
  dest: string | undefined
  push: boolean
  commit: string | undefined
  branch: string
}

const parseArgs = (argv: readonly string[]): Options => {
  const options: Options = {
    zip: undefined,
    dest: undefined,
    push: false,
    commit: process.env.QA_SOURCE_SHA || process.env.GITHUB_SHA,
    branch: process.env.QA_BRANCH || DEFAULT_BRANCH
  }

  const take = (flag: string, i: number): string => {
    const value = argv[i + 1]
    if (value === undefined || value.startsWith("-")) fail(`${flag} needs a value`)
    return value
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string
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

/**
 * Everything that has ever carried the credential, in every shape it takes.
 *
 * The `Authorization: Basic` arm is not optional. `execFileSync` puts the whole
 * argument vector into `error.message`, and the credential now travels as
 * `-c http.extraheader=…` — so moving the token out of the URL would have moved
 * it straight into the failure text if this had not moved with it. The URL arms
 * stay because a caller-supplied `QA_PUSH_REMOTE` may still embed userinfo.
 */
const redact = (text: unknown): string =>
  String(text)
    .replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@")
    .replace(/\/\/[^/\s:]+:[^@\s]+@/g, "//***@")
    .replace(/(http\.extraheader=Authorization:\s*\S+\s+)\S+/gi, "$1***")
    .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)\S+/gi, "$1***")

const run = (command: string, args: readonly string[], extra: Record<string, unknown> = {}): string => {
  try {
    return execFileSync(command, args as string[], { encoding: "utf8", ...extra }).trim()
  } catch (error) {
    const failure = error as { stderr?: string; message?: string }
    const detail = redact(failure.stderr || failure.message)
    // Name the subcommand, not `args[0]` — with `-c` options prepended for auth
    // that would report every failure as "git -c failed".
    const skipNext = new Set(["-C", "-c"])
    let verb = ""
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i] as string
      if (skipNext.has(arg)) { i += 1; continue }
      if (arg.startsWith("-")) continue
      verb = arg
      break
    }
    throw new Error(`${command} ${verb} failed: ${detail}`)
  }
}

const tryRun = (command: string, args: readonly string[]): string | undefined => {
  try {
    return run(command, args)
  } catch {
    return undefined
  }
}

const auditZip = (archive: string, root: string): void => {
  const checker = join(root, "store/check-release.ts")
  try {
    execFileSync(process.execPath, [checker, archive], { stdio: "inherit" })
  } catch {
    fail(`store audit rejected ${archive}`)
  }
}

interface ZipMeta {
  readonly entries: readonly string[]
  readonly manifest: { readonly version: string; readonly manifest_version?: number }
}

const zipMeta = (archive: string): ZipMeta => {
  try {
    const entries = run("unzip", ["-Z1", archive]).split("\n").filter(Boolean)
    const manifest = JSON.parse(run("unzip", ["-p", archive, "manifest.json"])) as { version?: string; manifest_version?: number }
    if (!manifest.version) fail("manifest.json has no version")
    return { entries, manifest: manifest as ZipMeta["manifest"] }
  } catch (error) {
    return fail(`cannot read ${archive}: ${(error as Error).message}`)
  }
}

const resolveCommit = (root: string, commit: string | undefined): string => {
  if (commit) return commit
  const sha = tryRun("git", ["-C", root, "rev-parse", "HEAD"])
  if (!sha) fail("could not determine source commit; pass --commit")
  return sha
}

const nodeVersion = () => process.env.QA_NODE_VERSION || process.version

/**
 * Never guess a version into the receipt.
 *
 * This used to fall back to the literal `"9.12.0"` when `pnpm -v` failed, which
 * writes a version that did not build the zip into the one file whose entire
 * job is to say what did. That is the same defect that was fixed for `node`
 * when `QA_NODE_VERSION: "24"` was removed from CI — the fix was applied to one
 * of the two lines and not the other. A receipt that is confidently wrong is
 * worse than one that is missing, so an unknown answer says so.
 */
const pnpmVersion = () => {
  if (process.env.QA_PNPM_VERSION) return process.env.QA_PNPM_VERSION
  return tryRun("pnpm", ["-v"]) ?? "unknown"
}

interface BuildTxt {
  readonly dest: string
  readonly commit: string
  readonly version: string
  readonly sha256: string
  readonly files: number
}

const writeBuildTxt = ({ dest, commit, version, sha256, files }: BuildTxt): void => {
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

interface Stage {
  readonly zip: string
  readonly dest: string
  readonly commit: string | undefined
  readonly root: string
}

const stage = ({ zip, dest, commit, root }: Stage) => {
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

interface Remote {
  readonly url: string
  readonly auth: readonly string[]
}

/**
 * The remote, and separately the credential — never the two spliced together.
 *
 * This used to return `https://x-access-token:${GITHUB_TOKEN}@github.com/...`,
 * which puts a live token into a URL that git then echoes into its own progress
 * output, into `git remote -v`, and into the error text of any failure. A
 * `redact()` helper covered two of those shapes on two error paths; the others
 * were one unexpected failure away from a token in a public build log.
 *
 * `http.extraheader` carries the credential out of band instead. It is passed
 * per-invocation with `-c`, so it never lands in the clone's config file
 * either — which matters because that clone is a temp directory this script
 * does not always control the lifetime of.
 */
const pushRemote = (root: string): Remote => {
  if (process.env.QA_PUSH_REMOTE) return { url: process.env.QA_PUSH_REMOTE, auth: [] }
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    const basic = Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString("base64")
    return {
      url: `https://github.com/${process.env.GITHUB_REPOSITORY}.git`,
      auth: ["-c", `http.extraheader=Authorization: Basic ${basic}`]
    }
  }
  /*
   * On a runner, falling back to a bare origin URL is not a fallback — it is a
   * push with no credentials, which fails several steps later as "could not
   * read Username". Say so here, where the cause is still visible.
   */
  if (process.env.GITHUB_ACTIONS === "true") {
    fail(
      "running in GitHub Actions with no push credentials: set GITHUB_TOKEN (and GITHUB_REPOSITORY) " +
        "on the step, or QA_PUSH_REMOTE. `actions/checkout` credentials do not reach this script's " +
        "own clone."
    )
  }
  const origin = tryRun("git", ["-C", root, "remote", "get-url", "origin"])
  if (!origin) fail("no git remote; set QA_PUSH_REMOTE or GITHUB_TOKEN + GITHUB_REPOSITORY")
  return { url: origin, auth: [] }
}

const gitIdentity = (root: string) => {
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

const remoteHasBranch = ({ url, auth }: Remote, branch: string): boolean => {
  const refs = run("git", [...auth, "ls-remote", "--heads", url, branch])
  return refs.length > 0
}

interface PushBranch {
  readonly dest: string
  readonly branch: string
  readonly root: string
  readonly version: string
  readonly commit: string
}

const pushBranch = ({ dest, branch, root, version, commit }: PushBranch): void => {
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
      run("git", [...remote.auth, "clone", "--branch", branch, "--single-branch", "--depth", "1", remote.url, work], {
        stdio: "pipe"
      })
    } else {
      run("git", ["init", "-b", branch, work])
      run("git", ["-C", work, "remote", "add", "origin", remote.url])
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
    /**
     * One commit, always — the branch is replaced rather than appended to.
     *
     * A plain push added another ~155 KB incompressible zip blob on every
     * successful `main` build, forever, to a branch that a default clone of a
     * public repository fetches in full. Nobody wants the third-most-recent QA
     * build, and the history was the thing PR #11 was closed for putting on
     * `main` — moving it to another branch relocated the cost rather than
     * removing it.
     *
     * `--force` is safe precisely because this branch is not source: it holds
     * a built artifact and its receipt, and `qa/chrome-mv3-latest` is named for
     * the one build it is meant to carry.
     */
    run("git", ["-C", work, "checkout", "--orphan", "published"])
    run("git", ["-C", work, "add", ZIP_NAME, BUILD_NAME])
    run("git", ["-C", work, "commit", "-m", message])
    run("git", ["-C", work, ...remote.auth, "push", "--force", "origin", `published:${branch}`])
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
 * A directory is accepted as well as a file, matching `store/check-release.ts`
 * and `store/cws.ts`.
 *
 * `wxt zip` names its artifact from the package version, so the path moves on
 * every bump; callers that hard-coded it are how the repository spent a while
 * auditing a `0.0.0` zip while shipping a `3.0.1` one. Exactly one match is
 * required — two means a stale build survived a bump, and silently picking one
 * is how the wrong artifact reaches the QA branch.
 */
const resolveArchive = (target: string): string => {
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
  return join(path, zips[0] as string)
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
