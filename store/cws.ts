#!/usr/bin/env node

/**
 * The Chrome Web Store, from a script.
 *
 * Talks to Chrome Web Store API **v2** (`chromewebstore.googleapis.com`) and
 * nothing else. v1 (`www.googleapis.com/chromewebstore/v1.1`) is what every
 * third-party publish action still uses and it is switched off on
 * **15 October 2026** — writing against it today would buy a rewrite in two
 * months, so this file never learned it.
 *
 * What v2 can do, and therefore what this file does: upload a package, ask what
 * state the item is in, submit it for review, cancel a submission, and move a
 * staged rollout's percentage. That is the entire API surface.
 *
 * What it CANNOT do, so that nobody goes looking: there is no method for the
 * store listing. Not the description, not the summary, not the screenshots, the
 * promo tiles, the category, the URLs or the privacy answers. Those exist only
 * in the Developer Dashboard, and `store/LISTING.md` is where that gap is
 * written down along with what to do about it.
 *
 * Commands
 *
 *   node store/cws.ts status                     what the store thinks it has
 *   node store/cws.ts gate <version>             ship=true|false, for CI
 *   node store/cws.ts upload <zip|dir>           upload a package, no submit
 *   node store/cws.ts publish                    submit the uploaded draft
 *   node store/cws.ts release <zip|dir>          upload, then submit
 *   node store/cws.ts cancel                     withdraw a pending submission
 *
 * `release` is the one CI runs, and it is deliberately a no-op when the store
 * already has the version being offered: the release workflow fires on every
 * push to `main`, so "nothing to do" is the common case and has to be quiet and
 * successful rather than a red build.
 *
 * Configuration, all through the environment (a `.env` at the repository root
 * is read first if present — it is gitignored, and CI passes real secrets
 * instead):
 *
 *   CWS_EXTENSION_ID           the item id. Defaults to Parle's.
 *   CWS_PUBLISHER_ID           Developer Dashboard → Publisher → Settings.
 *   CWS_SERVICE_ACCOUNT_KEY    the service account JSON key. Raw JSON, base64
 *                              of it, or a path to the file — all three work,
 *                              because a GitHub secret wants one line and a
 *                              developer's disk wants a file.
 *   CWS_ACCESS_TOKEN           a bearer token, if you already have one. Skips
 *                              the service account entirely.
 *   CWS_PUBLISH_TYPE           DEFAULT_PUBLISH (the default) or STAGED_PUBLISH.
 *   CWS_FORCE                  upload even when the store already holds this
 *                              version. The workflow's `force` input sets it.
 *
 * One limit worth knowing: `fetchStatus` reports the published and the submitted
 * revisions, and nothing else. A package that was uploaded but never submitted
 * is invisible to it, so `release` cannot tell that case apart from "never
 * uploaded". Re-uploading simply overwrites the draft, which is why that is the
 * behaviour chosen rather than something cleverer.
 */

import { createSign } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { basename, dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Parle's published item. Overridable so this file is testable against a throwaway item. */
const DEFAULT_EXTENSION_ID = "bbigpojahnmkdbdnbcmadnhbjlemibom"

/**
 * The v2 wire shapes, written down rather than inferred.
 *
 * This is the part of the port to TypeScript that earns itself. The worst bug
 * in this file's history was inventing `SUCCESS` and `UPLOAD_IN_PROGRESS` —
 * v1-shaped names v2 never returns — which made a live upload look settled and
 * then failed a successful one after the store had the bytes. A response typed
 * as `any` cannot tell you that; a named union can be read against the
 * reference and checked.
 */
type UploadState = "UPLOAD_STATE_UNSPECIFIED" | "SUCCEEDED" | "IN_PROGRESS" | "FAILED" | "NOT_FOUND"

interface DistributionChannel {
  readonly deployPercentage?: number
  readonly crxVersion?: string
}

interface ItemRevisionStatus {
  readonly state?: string
  readonly distributionChannels?: readonly DistributionChannel[]
}

interface FetchStatusResponse {
  readonly name?: string
  readonly itemId?: string
  readonly publicKey?: string
  readonly publishedItemRevisionStatus?: ItemRevisionStatus
  readonly submittedItemRevisionStatus?: ItemRevisionStatus
  readonly lastAsyncUploadState?: UploadState
  readonly takenDown?: boolean
  readonly warned?: boolean
}

interface UploadResponse {
  readonly itemId?: string
  readonly crxVersion?: string
  readonly uploadState?: UploadState
}

interface PublishResponse {
  readonly itemId?: string
  readonly state?: string
  readonly warningInfo?: { readonly warnings?: ReadonlyArray<{ readonly message?: string }> }
}

interface ServiceAccountKey {
  readonly client_email: string
  readonly private_key: string
  readonly project_id?: string
  readonly private_key_id?: string
}

const API = "https://chromewebstore.googleapis.com"
const SCOPE = "https://www.googleapis.com/auth/chromewebstore"
const TOKEN_URL = "https://oauth2.googleapis.com/token"

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/**
 * A deliberately small `.env` reader — `KEY=value`, `#` comments, optional
 * surrounding quotes. No interpolation, no multi-line values, no dependency.
 *
 * Multi-line is the interesting omission: a service account JSON key contains a
 * PEM private key full of newlines, so it cannot be pasted into a `.env` as-is.
 * That is why `CWS_SERVICE_ACCOUNT_KEY` accepts base64 and a file path.
 * Real environment variables always win over the file, so CI is never shadowed
 * by a stray local copy.
 */
const loadDotEnv = () => {
  const path = join(root, ".env")
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1] as string
    const rawValue = match[2] as string
    if (process.env[key] !== undefined) continue
    let value = rawValue.trim()
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, "").trim()
    process.env[key] = value
  }
}

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set — see the header of store/cws.ts`)
  return value
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

const base64url = (input: string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

/**
 * The key, however it was handed to us.
 *
 * A GitHub Actions secret is a single string, so the natural thing to put there
 * is base64 of the JSON. A developer on their own machine has the file Google
 * downloaded. Both are accepted, and so is raw JSON, because guessing wrong
 * about which one someone used is a worse failure than three cheap checks.
 */
const readServiceAccount = (): ServiceAccountKey => {
  const raw = required("CWS_SERVICE_ACCOUNT_KEY").trim()

  let text = raw
  if (!raw.startsWith("{")) {
    if (existsSync(raw)) text = readFileSync(raw, "utf8")
    else text = Buffer.from(raw, "base64").toString("utf8")
  }

  let key: ServiceAccountKey
  try {
    key = JSON.parse(text) as ServiceAccountKey
  } catch {
    throw new Error(
      "CWS_SERVICE_ACCOUNT_KEY is not a service account JSON key, a path to one, " +
        "or base64 of one. If it came from a GitHub secret, check it was base64 encoded " +
        "with no wrapping (`base64 -w0`)."
    )
  }
  if (!key.client_email || !key.private_key) {
    throw new Error("service account key has no client_email/private_key — is it an OAuth client file?")
  }
  return key
}

/**
 * Service account JSON key → access token, by the JWT-bearer grant.
 *
 * Google's own client libraries do exactly this; it is ~20 lines of `crypto`
 * and it keeps this script dependency-free, which matters because it runs in CI
 * before anything is installed and on a developer's machine years from now.
 */
const mintAccessToken = async (): Promise<string> => {
  const preMinted = process.env["CWS_ACCESS_TOKEN"]
  if (preMinted) return preMinted

  const key = readServiceAccount()
  const issued = Math.floor(Date.now() / 1000)
  const claims = {
    iss: key.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issued,
    exp: issued + 3600
  }

  const body = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`
  const signature = createSign("RSA-SHA256").update(body).sign(key.private_key)
  const assertion = `${body}.${signature.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `could not get an access token (${response.status}): ${text}\n` +
        `Check that the Chrome Web Store API is enabled on the key's project and that\n` +
        `${key.client_email} is registered in the Developer Dashboard under Account.`
    )
  }
  return JSON.parse(text).access_token
}

// ---------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------

const itemName = () =>
  `publishers/${required("CWS_PUBLISHER_ID")}/items/${process.env["CWS_EXTENSION_ID"] || DEFAULT_EXTENSION_ID}`

interface Call {
  readonly method: string
  readonly url: string
  readonly body?: string | Uint8Array
  readonly contentType?: string
}

const call = async <T>(token: string, { method, url, body, contentType }: Call): Promise<T> => {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(contentType ? { "content-type": contentType } : {})
    },
    // `null`, not `undefined`: `exactOptionalPropertyTypes` distinguishes
    // "absent" from "present and undefined", and `fetch` accepts only the former.
    body: (body ?? null) as BodyInit | null
  })
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!response.ok) {
    const detail = (parsed as { error?: { message?: string } })?.error?.message || text || response.statusText
    throw new Error(`${method} ${url.replace(API, "")} failed (${response.status}): ${detail}`)
  }
  return parsed as T
}

const fetchStatus = (token: string) =>
  call<FetchStatusResponse>(token, { method: "GET", url: `${API}/v2/${itemName()}:fetchStatus` })

const uploadPackage = (token: string, zip: string) =>
  call<UploadResponse>(token, {
    method: "POST",
    url: `${API}/upload/v2/${itemName()}:upload`,
    body: readFileSync(zip),
    contentType: "application/zip"
  })

const publishItem = (token: string, publishType: string) =>
  call<PublishResponse>(token, {
    method: "POST",
    url: `${API}/v2/${itemName()}:publish`,
    body: JSON.stringify({ publishType }),
    contentType: "application/json"
  })

const cancelSubmission = (token: string) =>
  call<unknown>(token, { method: "POST", url: `${API}/v2/${itemName()}:cancelSubmission`, contentType: "application/json", body: "{}" })

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

/**
 * Same rule as `store/check-release.ts`: a directory is fine, but it must hold
 * exactly one candidate. Two zips in `.output/` means a stale build survived a
 * version bump, and quietly picking one is how the wrong artifact ships.
 */
const resolveArchive = (target: string): string => {
  if (!existsSync(target)) throw new Error(`no such path: ${target}`)
  if (!statSync(target).isDirectory()) return target
  const zips = readdirSync(target).filter((name) => name.endsWith("-chrome.zip")).sort()
  if (zips.length === 0) throw new Error(`no *-chrome.zip in ${target} — run \`wxt zip\` first`)
  if (zips.length > 1) throw new Error(`${zips.length} zips in ${target} (${zips.join(", ")}) — clear the stale ones`)
  return join(target, zips[0] as string)
}

/**
 * The version Chrome will see, read from the zip itself rather than from
 * `package.json`.
 *
 * They should agree, and the build makes them agree — but the thing that gets
 * uploaded is the zip, so the thing that gets compared is the zip. `unzip -p`
 * rather than a zip library, for the same no-dependency reason as everything
 * else here; it is already required by `check-release.ts`.
 */
const versionOf = async (zip: string): Promise<string> => {
  const { execFileSync } = await import("node:child_process")
  return (JSON.parse(execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" })) as { version: string }).version
}

/** -1, 0, 1. Chrome versions: dotted integers, shorter ones zero-padded. */
const compare = (left: string, right: string): number => {
  const a = String(left).split(".").map(Number)
  const b = String(right).split(".").map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  return 0
}

/**
 * The highest version the store is holding, published or in review.
 *
 * Both have to be considered. Comparing against only the published revision
 * would re-upload a version that is already sitting in review — which the store
 * rejects — every time `main` moved while a review was open.
 */
const storeVersion = (status: FetchStatusResponse): string | undefined => {
  const versions = [status.publishedItemRevisionStatus, status.submittedItemRevisionStatus]
    .flatMap((revision) => revision?.distributionChannels ?? [])
    .map((channel) => channel.crxVersion)
    .filter((version): version is string => typeof version === "string")
  return versions.sort(compare).pop()
}

const describe = (status: FetchStatusResponse): string => {
  const line = (label: string, revision: ItemRevisionStatus | undefined) => {
    if (!revision) return `${label}: none`
    const channels = (revision.distributionChannels ?? [])
      .map((channel) => `v${channel.crxVersion} at ${channel.deployPercentage ?? 100}%`)
      .join(", ")
    return `${label}: ${revision.state ?? "unknown"}${channels ? ` · ${channels}` : ""}`
  }
  return [
    `item: ${status.itemId ?? "?"}`,
    line("published", status.publishedItemRevisionStatus),
    line("submitted", status.submittedItemRevisionStatus),
    `taken down: ${Boolean(status.takenDown)} · warned: ${Boolean(status.warned)}`,
    `last upload: ${status.lastAsyncUploadState ?? "n/a"}`
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * The store's own `UploadState` vocabulary, which is NOT what v1 used.
 *
 * v2 answers `SUCCEEDED` / `IN_PROGRESS` / `FAILED` / `NOT_FOUND` /
 * `UPLOAD_STATE_UNSPECIFIED`. This file was originally written against
 * `SUCCESS` / `UPLOAD_IN_PROGRESS`, which are v1-shaped names that v2 never
 * returns — and the failure mode was the worst available: a live `IN_PROGRESS`
 * looked "settled" so nothing polled, and a real `SUCCEEDED` then failed the
 * `=== "SUCCESS"` test and threw **after the store already had the bytes**.
 * The first automated release would have gone red with the upload accepted.
 *
 * Both families are accepted rather than just the correct one. The cost is a
 * set literal; the cost of being wrong again in the other direction is a red
 * build on an irreversible action.
 */
const UPLOAD_DONE = new Set(["SUCCEEDED", "SUCCESS"])
const UPLOAD_PENDING = new Set(["IN_PROGRESS", "UPLOAD_IN_PROGRESS", "UPLOAD_STATE_UNSPECIFIED", "NOT_FOUND"])

/**
 * `IN_PROGRESS` is a normal answer, not an error — the store takes the bytes
 * and validates them afterwards, so polling `fetchStatus` is how that verdict
 * arrives and a publish is never issued against a package it has not finished
 * accepting.
 *
 * `NOT_FOUND` and `UPLOAD_STATE_UNSPECIFIED` count as pending, not as failure:
 * on `lastAsyncUploadState` they mean the store has no async record *yet*,
 * which is indistinguishable from "a moment too early" and is not a reason to
 * abandon an upload that may have landed. The loop's deadline is what stops it.
 */
const waitForUpload = async (token: string, first: UploadResponse): Promise<string> => {
  const settled = (state: string | undefined): state is string => Boolean(state) && !UPLOAD_PENDING.has(state as string)
  if (settled(first.uploadState)) return first.uploadState

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const status = await fetchStatus(token)
    const state = status.lastAsyncUploadState
    if (settled(state)) return state
    process.stdout.write(`  still uploading (${attempt + 1}${state ? `, ${state}` : ""})\n`)
  }
  throw new Error("upload did not settle within about three minutes")
}

/** Throws unless the store actually accepted the package. */
const requireUploaded = (state: string): void => {
  if (UPLOAD_DONE.has(state)) return
  throw new Error(
    `upload finished as ${state} — expected one of ${[...UPLOAD_DONE].join(", ")}. ` +
      "The package was NOT submitted; nothing on the item changed."
  )
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async status() {
    const token = await mintAccessToken()
    process.stdout.write(`${describe(await fetchStatus(token))}\n`)
  },

  /**
   * "Is there anything to ship?", for the release workflow's cheap first job.
   *
   * Prints `ship=true|false` in the shape `$GITHUB_OUTPUT` wants. The comparison
   * is the same `compare` the `release` command uses — deliberately, because the
   * obvious alternative (grep the human-readable status for the version string)
   * answers "yes, already shipped" for v3.0.1 when the store holds v3.0.10.
   */
  async gate([version]: string[]) {
    if (!version) throw new Error("gate needs the version to offer")
    const token = await mintAccessToken()
    const status = await fetchStatus(token)
    const remote = storeVersion(status)
    const ship = !remote || compare(version, remote) > 0
    process.stderr.write(`${describe(status)}\nlocal: v${version}\n`)
    process.stdout.write(`ship=${ship}\n`)
  },

  async upload([target]: string[]) {
    if (!target) throw new Error("upload needs a zip, or the directory holding it")
    const zip = resolveArchive(target)
    const token = await mintAccessToken()
    process.stdout.write(`uploading ${basename(zip)} (v${await versionOf(zip)})\n`)
    const state = await waitForUpload(token, await uploadPackage(token, zip))
    requireUploaded(state)
    process.stdout.write("uploaded\n")
  },

  async publish() {
    const token = await mintAccessToken()
    const publishType = process.env["CWS_PUBLISH_TYPE"] || "DEFAULT_PUBLISH"
    const result = await publishItem(token, publishType)
    process.stdout.write(`submitted for review (${publishType}) · state ${result.state ?? "?"}\n`)
    for (const warning of result.warningInfo?.warnings ?? []) {
      process.stdout.write(`  warning: ${warning.message ?? JSON.stringify(warning)}\n`)
    }
  },

  async cancel() {
    const token = await mintAccessToken()
    await cancelSubmission(token)
    process.stdout.write("pending submission cancelled\n")
  },

  /**
   * Upload and submit, but only if there is anything to upload.
   *
   * The workflow that calls this runs on every push to `main`, so the ordinary
   * outcome is "the store already has this version" and that has to exit 0.
   * A build is only ever offered when its version is strictly greater than
   * anything the store holds — which is also the store's own rule, checked here
   * so the failure is a readable line rather than a 400 from Google.
   */
  async release([target]: string[]) {
    if (!target) throw new Error("release needs a zip, or the directory holding it")
    const zip = resolveArchive(target)
    const local = await versionOf(zip)
    const token = await mintAccessToken()
    const status = await fetchStatus(token)
    const remote = storeVersion(status)

    process.stdout.write(`${describe(status)}\nlocal: v${local}\n`)

    // `CWS_FORCE` is the workflow's `force` dispatch input, plumbed all the way
    // through. Without it the gate could be forced and this would still decline,
    // which made the input a control that looked like it did something.
    const forced = /^(1|true|yes)$/i.test(process.env["CWS_FORCE"] ?? "")

    if (remote && compare(local, remote) <= 0) {
      if (!forced) {
        process.stdout.write(`nothing to do — the store already has v${remote}\n`)
        return
      }
      // Say so rather than proceeding quietly: the store rejects an upload whose
      // version is not strictly greater, so a forced run at or below `remote` is
      // very likely about to fail, and the reason should be on the log already.
      process.stdout.write(
        `CWS_FORCE set — uploading v${local} even though the store has v${remote}. ` +
          "The store rejects a version that is not strictly greater, so expect a 400 unless " +
          "this is re-uploading a draft.\n"
      )
    }

    const state = await waitForUpload(token, await uploadPackage(token, zip))
    requireUploaded(state)

    const publishType = process.env["CWS_PUBLISH_TYPE"] || "DEFAULT_PUBLISH"
    const result = await publishItem(token, publishType)
    process.stdout.write(`v${local} uploaded and submitted (${publishType}) · state ${result.state ?? "?"}\n`)
    for (const warning of result.warningInfo?.warnings ?? []) {
      process.stdout.write(`  warning: ${warning.message ?? JSON.stringify(warning)}\n`)
    }
  }
}

const main = async () => {
  loadDotEnv()
  const [command, ...args] = process.argv.slice(2)
  if (!command || !commands[command]) {
    process.stderr.write(`usage: node store/cws.ts <${Object.keys(commands).join("|")}> [args]\n`)
    process.exit(1)
  }
  await commands[command](args)
}

main().catch((error: unknown) => {
  console.error(`cws: ${(error as Error).message}`)
  process.exit(1)
})
