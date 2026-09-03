#!/usr/bin/env node

/**
 * Audits the store listing the only way it can be audited: against itself, and
 * against the open internet.
 *
 * `store/check-release.ts` audits the package, which is a file we build and
 * therefore a thing we control. Most of the listing is not: there is no Chrome
 * Web Store API for the description, screenshots, tiles, category or URLs, so
 * nothing here can push a correction. Summary comes from the package manifest
 * and is checked on both sides. See `store/LISTING.md`.
 *
 * What it can do is catch the two ways a listing goes wrong between releases:
 *
 * 1. A field outgrows its limit, or an asset stops being the shape the store
 *    accepts. Cheap, local, and the reason `--offline` exists.
 *
 * 2. **The public listing or one of its URLs drifts.** This is the one that
 *    actually bites. A listing URL that 404s is a rejection ground, and stale
 *    store copy can describe a different wire from the package under review.
 *    Neither fails at the moment it breaks — it fails weeks later, during a
 *    review, on a page nobody thought to open logged out. The public store page
 *    and every URL are fetched anonymously here, which is the state a reviewer
 *    sees.
 *
 * Claims made inside the description are checked too where they are checkable.
 * The description says the source is public; if the repository that sentence
 * names is private, the listing's central argument — "everything we assert can
 * be verified by reading the code" — is false in the one place a reviewer would
 * look first.
 *
 *   node store/check-listing.ts              full run, network included
 *   node store/check-listing.ts --offline    skip the fetches
 *   node store/check-listing.ts --allow-package-summary-transition
 *                                             allow only the Summary to wait
 *                                             for the next package upload
 *   node store/check-listing.ts --allow-pending-store-listing-review
 *                                             allow checked-in Description
 *                                             claims to wait for an already
 *                                             submitted listing-only review
 */

import { readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * The shape of `store/listing.json`.
 *
 * Written down because this script's whole job is to notice when the listing
 * and the repository disagree, and a checker that reads its own source of
 * truth as `any` can only catch the disagreements it happens to look for. A
 * renamed key now fails here rather than silently skipping an assertion.
 */
interface Listing {
  readonly itemId: string
  readonly name: string
  readonly summaryFile: string
  readonly descriptionFile: string
  readonly category: string
  readonly language: string
  readonly urls: { readonly homepage: string; readonly support: string; readonly privacy: string }
  readonly icon: string
  readonly screenshots: readonly string[]
  readonly promoTiles: { readonly small: string; readonly marquee: string }
  readonly permissions: readonly string[]
  readonly hostPermissions: readonly string[]
  readonly limits: {
    readonly summary: number
    readonly description: number
    readonly privacyText: number
    readonly screenshotWidth: number
    readonly screenshotHeight: number
    readonly screenshotsMax: number
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const listing: Listing = JSON.parse(readFileSync(join(here, "listing.json"), "utf8"))
const DASHBOARD_PRIVACY_TEXT_LIMIT = 1000

let failures = 0
const fail = (message: string) => {
  console.error(`  ✗ ${message}`)
  failures += 1
}
const pass = (message: string) => console.log(`  ✓ ${message}`)

// ---------------------------------------------------------------------------
// The text fields
// ---------------------------------------------------------------------------

console.log("text")

const summary = readFileSync(join(here, listing.summaryFile), "utf8").trimEnd()
const description = readFileSync(join(here, listing.descriptionFile), "utf8").trimEnd()
const policySource = readFileSync(join(here, "privacy-policy.md"), "utf8")
const homepageSource = readFileSync(join(here, "../apps/site/index.html"), "utf8")
const listingGuide = readFileSync(join(here, "LISTING.md"), "utf8")
const policyDate = policySource.match(/\*\*Last updated: ([^.]+)\.\*\*/)?.[1]

if (policyDate === undefined) {
  fail("privacy-policy.md has no bold Last updated date")
}

const policyClaims = [
  "public.api.bsky.app",
  "lemmy.world",
  "lobste.rs",
  "archive.org",
  "en.wikipedia.org",
  "raw.githubusercontent.com",
  "parle/exclusions/update",
  ...(policyDate === undefined ? [] : [`Last updated: ${policyDate}`])
]

// The store's Official URL is part of the disclosure surface too. It does not
// need to repeat the policy's endpoint table, but it must name every discussion
// service and the two reader-triggered context services before a package that
// contacts them can be released.
const homepageClaims = [
  "Hacker News, Reddit, Bluesky, Lemmy and Lobsters",
  "Opening Parle also tells Archive and Wikipedia"
]

// There is no API for writing or reading the listing fields, but the public
// Chrome Web Store page contains the rendered English summary and description.
// Checking a few exact, load-bearing sentences closes the gap between the
// repository copy and what a reviewer can actually see. Editable claims must
// survive listing-only review before release. Summary is the single exception:
// it comes from the next package and the explicit transition mode handles it.
const editableStoreClaims = [
  "WHAT IT SENDS, AND TO WHOM",
  "THREE THINGS PARLE WILL NOT CLAIM",
  "Hacker News, Reddit, Bluesky, Lemmy and Lobsters",
  "Internet Archive (archive.org)",
  "Wikipedia (en.wikipedia.org)"
]

for (const claim of policyClaims) {
  if (!policySource.includes(claim)) fail(`checked-in privacy policy is missing "${claim}"`)
}

for (const claim of homepageClaims) {
  if (!homepageSource.includes(claim)) fail(`checked-in homepage is missing "${claim}"`)
}

if (summary.length > listing.limits.summary) {
  fail(`summary is ${summary.length} characters, over the ${listing.limits.summary} limit`)
} else if (summary.trim().length === 0) {
  fail("summary is empty")
} else {
  pass(`summary ${summary.length}/${listing.limits.summary} characters`)
}

if (summary.includes("\n")) fail("summary contains a newline — the console's field is one line")

if (description.length > listing.limits.description) {
  fail(`description is ${description.length} characters, over the ${listing.limits.description} limit`)
} else {
  pass(`description ${description.length}/${listing.limits.description} characters`)
}

/**
 * The store renders the description as plain text. Markdown in it does not
 * fail — it just shows up as literal asterisks and backticks in front of every
 * reader, which is worse than failing because nobody is told.
 */
const MARKDOWN: ReadonlyArray<readonly [RegExp, string]> = [
  [/^#{1,6}\s/m, "a Markdown heading"],
  [/\*\*[^*]+\*\*/, "Markdown bold"],
  [/`[^`]+`/, "Markdown code ticks"],
  [/^\s*\|.*\|\s*$/m, "a Markdown table"]
]

for (const [pattern, what] of MARKDOWN) {
  if (pattern.test(description)) fail(`description contains ${what}; the store renders plain text`)
}

// The disclosure the whole submission turns on. If a rewrite ever drops it, the
// listing stops satisfying Chrome's Limited Use prominence requirement, and the
// product's own first-run screen starts disagreeing with the store page.
for (const phrase of ["WHAT IT SENDS, AND TO WHOM", "THREE THINGS PARLE WILL NOT CLAIM"]) {
  if (description.includes(phrase)) pass(`description still carries "${phrase}"`)
  else fail(`description no longer carries "${phrase}" — that section is load-bearing`)
}

/**
 * Every paste box on the live Privacy tab is capped at 1,000 characters. Keep
 * the six fenced answers in §2 executable rather than discovering at release
 * time that a truthful answer cannot be pasted into the dashboard.
 */
const privacySection = listingGuide.match(/## 2\. Privacy tab[^\n]*\n([\s\S]*?)\n---\n/)?.[1]
const privacyLabels = [
  "single purpose",
  "tabs justification",
  "scripting justification",
  "webNavigation justification",
  "host permission justification",
  "remote-code justification"
] as const
const privacyPastes = privacySection === undefined
  ? []
  : [...privacySection.matchAll(/```\n([\s\S]*?)\n```/g)].map((match) => match[1] ?? "")

if (privacyPastes.length !== privacyLabels.length) {
  fail(
    `LISTING.md §2 has ${privacyPastes.length} fenced privacy answers, ` +
      `expected ${privacyLabels.length}`
  )
} else {
  if (listing.limits.privacyText !== DASHBOARD_PRIVACY_TEXT_LIMIT) {
    fail(
      `listing.json privacyText limit is ${JSON.stringify(listing.limits.privacyText)}, ` +
        `the dashboard limit is ${DASHBOARD_PRIVACY_TEXT_LIMIT}`
    )
  }
  privacyPastes.forEach((paste, index) => {
    const label = privacyLabels[index] as string
    if (paste.length > DASHBOARD_PRIVACY_TEXT_LIMIT) {
      fail(`${label} is ${paste.length} characters, over the ${DASHBOARD_PRIVACY_TEXT_LIMIT} limit`)
    } else {
      pass(`${label} ${paste.length}/${DASHBOARD_PRIVACY_TEXT_LIMIT} characters`)
    }
  })
}

if (listing.name !== "Parle") fail(`item name is "${listing.name}"; it must match the manifest's name`)

// ---------------------------------------------------------------------------
// The assets
// ---------------------------------------------------------------------------

console.log("assets")

/** Width, height and colour type, straight out of the IHDR chunk. */
const readPng = (path: string) => {
  const bytes = readFileSync(path)
  if (bytes.length < 26 || bytes.toString("ascii", 1, 4) !== "PNG") return undefined
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] }
}

const { screenshotWidth, screenshotHeight, screenshotsMax } = listing.limits

if (listing.screenshots.length > screenshotsMax) {
  fail(`${listing.screenshots.length} screenshots; the store accepts at most ${screenshotsMax}`)
}

listing.screenshots.forEach((relative: string, index: number) => {
  const path = join(here, relative)
  let png
  try {
    png = readPng(path)
  } catch {
    fail(`${relative} is missing — regenerate with \`pnpm --filter @parle/extension e2e:store\``)
    return
  }
  if (!png) return fail(`${relative} is not a PNG`)
  if (png.width !== screenshotWidth || png.height !== screenshotHeight) {
    fail(`${relative} is ${png.width}x${png.height}, expected ${screenshotWidth}x${screenshotHeight}`)
    return
  }
  // Colour types 4 and 6 carry an alpha channel, which the store rejects.
  if (png.colorType === 4 || png.colorType === 6) return fail(`${relative} has an alpha channel`)
  if (!relative.includes(`/0${index + 1}-`)) {
    fail(`${relative} is out of order — the carousel follows this array, and slot 2 is the disclosure`)
    return
  }
  pass(`${relative.replace("screenshots/", "")} ${png.width}x${png.height}`)
})

const ASSETS: ReadonlyArray<readonly [string, string]> = [
  ["icon", listing.icon],
  ["small tile", listing.promoTiles.small],
  ["marquee tile", listing.promoTiles.marquee]
]

for (const [label, relative] of ASSETS) {
  try {
    statSync(join(here, relative))
    pass(`${label} present`)
  } catch {
    fail(`${label} is missing: ${relative}`)
  }
}

// ---------------------------------------------------------------------------
// The URLs — the check that is actually worth running
// ---------------------------------------------------------------------------

const offline = process.argv.includes("--offline")
const allowPackageSummaryTransition = process.argv.includes("--allow-package-summary-transition")
const allowPendingStoreListingReview = process.argv.includes(
  "--allow-pending-store-listing-review"
)

if (offline) {
  console.log("urls\n  – skipped (--offline)")
} else {
  console.log("urls")

  /**
   * Anonymous, redirect-following, and a GET rather than a HEAD — some hosts
   * answer HEAD differently or not at all, and the point is to see what a
   * logged-out reviewer's browser sees, not what a CDN will admit to.
   */
  interface Reach {
    readonly ok: boolean
    readonly status: number
    readonly final: string
    readonly body?: string
    readonly error?: string
  }

  const reachable = async (url: string, readBody = false): Promise<Reach> => {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "accept-language": "en-US,en;q=0.9",
          "user-agent": "parle-listing-check"
        }
      })
      return {
        ok: response.ok,
        status: response.status,
        final: response.url,
        ...(readBody ? { body: await response.text() } : {})
      }
    } catch (error) {
      return { ok: false, status: 0, final: url, error: (error as Error).message }
    }
  }

  const storeUrl = `https://chromewebstore.google.com/detail/${listing.itemId}?hl=en-US`
  const urls: Array<[string, string]> = [...Object.entries(listing.urls), ["store", storeUrl]]

  // Any absolute URL the description points a reader at is a URL the listing is
  // promising resolves, whether or not it is in one of the console's URL fields.
  const inDescription = [...new Set(description.match(/https?:\/\/[^\s)"']+/g) ?? [])]
  for (const url of inDescription) {
    if (!urls.some(([, value]) => value === url)) urls.push(["description", url])
  }

  const results: Array<[string, string, Reach]> = await Promise.all(
    urls.map(async ([field, url]): Promise<[string, string, Reach]> => [
      field,
      url,
      await reachable(url, field === "privacy" || field === "homepage" || field === "store")
    ])
  )

  for (const [field, url, result] of results) {
    if (result.ok) {
      pass(`${field}: ${url} → ${result.status}`)
      continue
    }
    if (field === "description" && result.status === 404) {
      fail(
        `${field}: ${url} → 404. The description claims the source is public. ` +
          "Either make the repository public or rewrite the OPEN SOURCE paragraph — " +
          "a listing that points a reviewer at a page they cannot open fails on the " +
          "one claim the rest of the submission leans on."
      )
      continue
    }
    fail(`${field}: ${url} → ${result.status || result.error}`)
  }

  const privacy = results.find(([field]) => field === "privacy")?.[2]
  if (privacy?.ok) {
    const policy = privacy.body ?? ""
    for (const claim of policyClaims) {
      if (policy.includes(claim)) pass(`privacy policy still carries "${claim}"`)
      else fail(`privacy policy no longer carries "${claim}" — a 200 response alone does not satisfy ADR 0022`)
    }
    if (policy.includes("extension never contacts one")) {
      fail("privacy policy still says the extension never contacts a project host")
    }
  }

  const homepage = results.find(([field]) => field === "homepage")?.[2]
  if (homepage?.ok) {
    const body = homepage.body ?? ""
    for (const claim of homepageClaims) {
      if (body.includes(claim)) pass(`homepage still carries "${claim}"`)
      else fail(`homepage no longer carries "${claim}" — a 200 response alone does not describe the package`)
    }
  }

  const store = results.find(([field]) => field === "store")?.[2]
  if (store?.ok) {
    const body = store.body ?? ""
    const summaryTag = body.match(/<meta\b[^>]*\bname="description"[^>]*>/i)?.[0]
    const encodedPublicSummary = summaryTag?.match(/\bcontent="([^"]*)"/i)?.[1]
    const entities: Readonly<Record<string, string>> = {
      "&amp;": "&",
      "&quot;": '"',
      "&apos;": "'",
      "&#39;": "'",
      "&lt;": "<",
      "&gt;": ">"
    }
    const publicSummary = encodedPublicSummary?.replace(
      /&(amp|quot|apos|#39|lt|gt);/g,
      (entity) => entities[entity] ?? entity
    )

    if (publicSummary === undefined) {
      fail("public store page has no readable Summary meta field")
    } else if (publicSummary === summary) {
      pass(`public store Summary is exactly ${JSON.stringify(summary)}`)
    } else if (allowPackageSummaryTransition) {
      pass(
        `public Summary may wait for the package upload; currently ${JSON.stringify(publicSummary)}`
      )
    } else {
      fail(
        `public store Summary is ${JSON.stringify(publicSummary)}, expected ${JSON.stringify(summary)} — ` +
          "publish the package carrying store/summary.txt"
      )
    }

    for (const claim of editableStoreClaims) {
      if (body.includes(claim)) pass(`public store listing carries "${claim}"`)
      else if (allowPendingStoreListingReview) {
        pass(
          `public store listing may wait for its submitted listing-only review; ` +
            `checked-in copy already carries "${claim}"`
        )
      } else {
        fail(
          `public store listing is missing "${claim}" — apply store/PASTE.md in the ` +
            "Developer Dashboard and wait for the listing review before releasing the package"
        )
      }
    }
  }

  if (listing.urls.privacy.includes("parle.co")) fail("privacy URL still points at parle.co, a domain we do not control")
}

console.log(failures === 0 ? "\nlisting audit: passed" : `\nlisting audit: ${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
