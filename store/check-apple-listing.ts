#!/usr/bin/env node

/**
 * Audit the paste-ready App Store and TestFlight metadata without contacting or
 * mutating App Store Connect.
 *
 * Screenshot plans are allowed to remain explicitly pending while metadata is
 * prepared. Once a platform is marked ready, every ordered path becomes a hard
 * requirement. A pending gate is visible output but not a process failure.
 *
 *   node store/check-apple-listing.ts
 */

import { existsSync, readFileSync } from "node:fs"
import { extname, basename, dirname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

type ScreenshotStatus = "pending" | "ready"

interface ScreenshotSet {
  readonly status: ScreenshotStatus
  readonly paths: readonly string[]
}

interface AppleListing {
  readonly app: {
    readonly appleId: string
    readonly sku: string
    readonly marketingVersion: string
    readonly bundleId: string
    readonly extensionBundleId: string
    readonly nameFile: string
  }
  readonly localization: {
    readonly locale: string
    readonly language: string
    readonly manifestDescriptionFile: string
    readonly subtitleFile: string
    readonly promotionalTextFile: string
    readonly descriptionFile: string
    readonly keywordsFile: string
  }
  readonly testFlight: {
    readonly betaDescriptionFile: string
    readonly whatToTestFile: string
    readonly feedbackEmail: string
    readonly marketingUrl: string
    readonly privacyPolicyUrl: string
  }
  readonly review: {
    readonly notesFile: string
    readonly signInRequired: boolean
    readonly release: string
  }
  readonly classification: {
    readonly primaryCategory: string
    readonly secondaryCategory: string
    readonly price: string
    readonly platforms: readonly string[]
    readonly deviceFamilies: readonly string[]
  }
  readonly urls: {
    readonly marketing: string
    readonly support: string
    readonly privacy: string
  }
  readonly privacy: {
    readonly collectionAnswer: string
    readonly tracking: boolean
    readonly rationaleFile: string
  }
  readonly assets: {
    readonly brandIconSource: string
    readonly appleAppIconSource: string
    readonly appIconDelivery: string
  }
  readonly screenshots: Readonly<Record<"iphone" | "ipad" | "macos", ScreenshotSet>>
  readonly limits: {
    readonly manifestDescriptionCharacters: number
    readonly nameCharacters: number
    readonly subtitleCharacters: number
    readonly promotionalTextCharacters: number
    readonly descriptionCharacters: number
    readonly keywordsUtf8Bytes: number
    readonly screenshotsPerPlatformMin: number
    readonly screenshotsPerPlatformMax: number
  }
}

const storeRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(storeRoot, "..")
const listingPath = resolve(storeRoot, "apple/listing.json")
const listing: AppleListing = JSON.parse(readFileSync(listingPath, "utf8"))
const guidePath = resolve(storeRoot, "apple/LISTING.md")
const guide = readFileSync(guidePath, "utf8")

const APPLE_LIMITS = {
  manifestDescriptionCharacters: 112,
  nameCharacters: 30,
  subtitleCharacters: 30,
  promotionalTextCharacters: 170,
  descriptionCharacters: 4_000,
  keywordsUtf8Bytes: 100,
  screenshotsPerPlatformMin: 1,
  screenshotsPerPlatformMax: 10
} as const

let failures = 0
let pending = 0

const fail = (message: string): void => {
  console.error(`  x ${message}`)
  failures += 1
}
const pass = (message: string): void => console.log(`  ok ${message}`)
const wait = (message: string): void => {
  console.log(`  pending ${message}`)
  pending += 1
}

const same = (actual: unknown, expected: unknown, label: string): void => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(`${label} is locked`)
  else fail(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

const storePath = (relativePath: string): string => {
  const path = resolve(storeRoot, relativePath)
  const withinStore = relative(storeRoot, path)
  if (withinStore === "" || withinStore.startsWith(`..${sep}`) || withinStore === "..") {
    fail(`${relativePath} resolves outside store/`)
  }
  return path
}

const textFile = (relativePath: string): string => {
  const path = storePath(relativePath)
  if (!existsSync(path)) {
    fail(`${relativePath} is missing`)
    return ""
  }
  return readFileSync(path, "utf8").trimEnd()
}

const characterCount = (value: string): number => Array.from(value).length

const withinCharacters = (label: string, value: string, limit: number): void => {
  const count = characterCount(value)
  if (count === 0) fail(`${label} is empty`)
  else if (count > limit) fail(`${label} is ${count} characters, over Apple's ${limit} limit`)
  else pass(`${label} ${count}/${limit} characters`)
}

const oneLine = (label: string, value: string): void => {
  if (/\r|\n/.test(value)) fail(`${label} must be one line`)
  if (value !== value.trim()) fail(`${label} has leading or trailing whitespace`)
}

const carries = (label: string, source: string, phrases: readonly string[]): void => {
  const normalized = source.replace(/\s+/g, " ").toLocaleLowerCase("en-US")
  for (const phrase of phrases) {
    if (normalized.includes(phrase.replace(/\s+/g, " ").toLocaleLowerCase("en-US"))) {
      pass(`${label} carries ${JSON.stringify(phrase)}`)
    } else {
      fail(`${label} is missing load-bearing phrase ${JSON.stringify(phrase)}`)
    }
  }
}

console.log("contract")

same(listing.limits, APPLE_LIMITS, "Apple field limits")
same(listing.app.appleId, "6804834031", "Apple ID")
same(listing.app.sku, "parle", "SKU")
same(listing.app.marketingVersion, "1.0", "Apple marketing version")
same(listing.app.bundleId, "com.ziahamza.parle", "app bundle identifier")
same(listing.app.extensionBundleId, "com.ziahamza.parle.Extension", "extension bundle identifier")
same(listing.localization.locale, "en-US", "locale")
same(listing.localization.language, "English (U.S.)", "language")
same(
  listing.localization.manifestDescriptionFile,
  "apple/manifest-description.txt",
  "Safari manifest description file"
)
same(listing.classification.primaryCategory, "News", "primary category")
same(listing.classification.secondaryCategory, "Utilities", "secondary category")
same(listing.classification.price, "Free", "price")
same(listing.classification.platforms, ["iOS", "macOS"], "platforms")
same(listing.classification.deviceFamilies, ["iPhone", "iPad", "Mac"], "device families")
same(listing.review.signInRequired, false, "sign-in requirement")
same(listing.review.release, "Manual", "release mode")

const testFlightScript = readFileSync(
  resolve(repoRoot, "apps/extension/scripts/apple-testflight.sh"),
  "utf8"
)
const testFlightWorkflow = readFileSync(
  resolve(repoRoot, ".github/workflows/apple-testflight.yml"),
  "utf8"
)
same(
  testFlightScript.includes('VERSION="${APPLE_MARKETING_VERSION:-1.0}"'),
  true,
  "TestFlight script defaults independently to Apple version 1.0"
)
same(
  testFlightWorkflow.includes('APPLE_MARKETING_VERSION: "1.0"'),
  true,
  "TestFlight workflow pins Apple version 1.0"
)

const expectedUrls = {
  marketing: "https://ziahamza.com/parle",
  support: "https://ziahamza.com/parle/support",
  privacy: "https://ziahamza.com/parle/privacy"
} as const

same(listing.urls, expectedUrls, "product URLs")
same(listing.testFlight.feedbackEmail, "support@ziahamza.com", "TestFlight feedback email")
same(listing.testFlight.marketingUrl, expectedUrls.marketing, "TestFlight marketing URL")
same(listing.testFlight.privacyPolicyUrl, expectedUrls.privacy, "TestFlight privacy URL")
same(listing.privacy.collectionAnswer, "No, we do not collect data from this app", "App Privacy answer")
same(listing.privacy.tracking, false, "tracking answer")
same(listing.assets.appleAppIconSource, "apple/app-icon-1024.png", "Apple AppIcon source")
same(listing.assets.appIconDelivery, "The signed binary's AppIcon asset catalog", "app icon delivery")

console.log("text")

const name = textFile(listing.app.nameFile)
const manifestDescription = textFile(listing.localization.manifestDescriptionFile)
const subtitle = textFile(listing.localization.subtitleFile)
const promotionalText = textFile(listing.localization.promotionalTextFile)
const description = textFile(listing.localization.descriptionFile)
const keywords = textFile(listing.localization.keywordsFile)
const betaDescription = textFile(listing.testFlight.betaDescriptionFile)
const whatToTest = textFile(listing.testFlight.whatToTestFile)
const reviewNotes = textFile(listing.review.notesFile)
const privacyRationale = textFile(listing.privacy.rationaleFile)

same(name, "Parle for Safari", "app name")
withinCharacters(
  "Safari manifest description",
  manifestDescription,
  APPLE_LIMITS.manifestDescriptionCharacters
)
withinCharacters("name", name, APPLE_LIMITS.nameCharacters)
withinCharacters("subtitle", subtitle, APPLE_LIMITS.subtitleCharacters)
withinCharacters("promotional text", promotionalText, APPLE_LIMITS.promotionalTextCharacters)
withinCharacters("description", description, APPLE_LIMITS.descriptionCharacters)
oneLine("name", name)
oneLine("Safari manifest description", manifestDescription)
oneLine("subtitle", subtitle)
oneLine("promotional text", promotionalText)
oneLine("keywords", keywords)
carries("Safari manifest description", manifestDescription, [
  "Hacker News, Reddit, Bluesky, Lemmy and Lobsters",
  "Finding them tells those sites which page"
])

const keywordBytes = Buffer.byteLength(keywords, "utf8")
if (keywordBytes === 0) fail("keywords are empty")
else if (keywordBytes > APPLE_LIMITS.keywordsUtf8Bytes) {
  fail(`keywords are ${keywordBytes} UTF-8 bytes, over Apple's ${APPLE_LIMITS.keywordsUtf8Bytes}-byte limit`)
} else {
  pass(`keywords ${keywordBytes}/${APPLE_LIMITS.keywordsUtf8Bytes} UTF-8 bytes`)
}

const keywordParts = keywords.split(",")
if (keywordParts.some((keyword) => keyword !== keyword.trim() || characterCount(keyword) < 3)) {
  fail("keywords must be comma-separated, trimmed, and longer than two characters")
}
if (new Set(keywordParts.map((keyword) => keyword.toLocaleLowerCase("en-US"))).size !== keywordParts.length) {
  fail("keywords contain a duplicate")
}

const forbiddenKeywords = ["parle", "safari", "hacker news", "reddit", "bluesky", "lemmy", "lobsters"]
for (const keyword of forbiddenKeywords) {
  if (keywordParts.some((part) => part.toLocaleLowerCase("en-US") === keyword)) {
    fail(`keywords repeat the app name or another product name: ${JSON.stringify(keyword)}`)
  }
}

const MARKDOWN = [
  /^#{1,6}\s/m,
  /\*\*[^*]+\*\*/,
  /`[^`]+`/,
  /^\s*\|.*\|\s*$/m,
  /<\/?[a-z][^>]*>/i
]
if (MARKDOWN.some((pattern) => pattern.test(description))) {
  fail("description contains Markdown or HTML; App Store description is plain text")
}

carries("description", description, [
  "Hacker News, Reddit, Bluesky, Lemmy, and Lobsters",
  "Internet Archive",
  "Wikipedia",
  "only the pages where you explicitly opened Parle",
  "100 pages for 30 days",
  "No account or sign-in",
  "No backend operated by us",
  "No analytics or telemetry",
  "No remote code"
])

carries("beta description", betaDescription, [
  "Hacker News, Reddit, Bluesky, Lemmy, and Lobsters",
  "only pages where you explicitly opened Parle",
  "100 pages or 30 days",
  "no account, backend, analytics, or telemetry"
])

carries("What to Test", whatToTest, [
  "Passive browsing",
  "Open original page",
  "Open archived copy",
  "All Parle discussions",
  "every row shown in the panel",
  "Clear Recents",
  "100 pages",
  "30 days"
])

carries("App Review notes", reviewNotes, [
  "NO SIGN-IN OR DEMO ACCOUNT IS REQUIRED",
  "Hacker News, Reddit, Bluesky, Lemmy, and Lobsters",
  "Open original page",
  "Open archived copy",
  "All Parle discussions",
  "device-local",
  "real-time functional requests",
  "No remote code is downloaded or executed"
])

carries("App Privacy rationale", privacyRationale, [
  "No, we do not collect data from this app",
  "longer than is needed to service the request in real time",
  "no developer server",
  "local App Group container",
  "100 pages or 30 days",
  "code is not embedded in Parle",
  "Change the App Privacy answers before release"
])

console.log("assets")

const brandIcon = storePath(listing.assets.brandIconSource)
if (existsSync(brandIcon)) pass(`${listing.assets.brandIconSource} exists as the brand source`)
else fail(`${listing.assets.brandIconSource} is missing`)

const platformNames = ["iphone", "ipad", "macos"] as const
const allScreenshotPaths = new Set<string>()
const screenshotDimensions = {
  iphone: "1284x2778",
  ipad: "2048x2732",
  macos: "1280x800"
} as const

const inspectImage = (
  path: string
): { format: "jpeg" | "png"; width: number; height: number; hasAlpha: boolean } | undefined => {
  const bytes = readFileSync(path)
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    let offset = 8
    let width = 0
    let height = 0
    let hasAlpha = false
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset)
      const type = bytes.toString("ascii", offset + 4, offset + 8)
      if (offset + 12 + length > bytes.length) return undefined
      if (type === "IHDR") {
        width = bytes.readUInt32BE(offset + 8)
        height = bytes.readUInt32BE(offset + 12)
        hasAlpha = [4, 6].includes(bytes[offset + 17] ?? -1)
      } else if (type === "tRNS") {
        hasAlpha = true
      }
      offset += 12 + length
    }
    return width > 0 && height > 0 ? { format: "png", width, height, hasAlpha } : undefined
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2
    while (offset + 8 < bytes.length) {
      while (bytes[offset] === 0xff) offset += 1
      const marker = bytes[offset] ?? 0
      offset += 1
      if (marker === 0xd8 || marker === 0xd9) continue
      if (offset + 2 > bytes.length) return undefined
      const length = bytes.readUInt16BE(offset)
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          format: "jpeg",
          height: bytes.readUInt16BE(offset + 3),
          width: bytes.readUInt16BE(offset + 5),
          hasAlpha: false
        }
      }
      if (length < 2) return undefined
      offset += length
    }
  }
  return undefined
}

const appleAppIcon = storePath(listing.assets.appleAppIconSource)
if (!existsSync(appleAppIcon)) {
  fail(`${listing.assets.appleAppIconSource} is missing`)
} else {
  const image = inspectImage(appleAppIcon)
  if (image?.format !== "png") fail(`${listing.assets.appleAppIconSource} is not a readable PNG`)
  else if (image.width !== 1_024 || image.height !== 1_024) {
    fail(`${listing.assets.appleAppIconSource} is ${image.width}x${image.height}, expected 1024x1024`)
  } else if (image.hasAlpha) {
    fail(`${listing.assets.appleAppIconSource} has alpha; Apple requires an opaque AppIcon`)
  } else {
    pass(`${listing.assets.appleAppIconSource} is an opaque 1024x1024 PNG`)
  }
}

for (const platform of platformNames) {
  const set = listing.screenshots[platform]
  if (set === undefined) {
    fail(`${platform} screenshot plan is missing`)
    continue
  }

  if (set.paths.length < APPLE_LIMITS.screenshotsPerPlatformMin ||
      set.paths.length > APPLE_LIMITS.screenshotsPerPlatformMax) {
    fail(
      `${platform} plans ${set.paths.length} screenshots; Apple requires ` +
      `${APPLE_LIMITS.screenshotsPerPlatformMin}-${APPLE_LIMITS.screenshotsPerPlatformMax}`
    )
  }

  set.paths.forEach((relativePath, index) => {
    if (allScreenshotPaths.has(relativePath)) fail(`screenshot path is reused: ${relativePath}`)
    allScreenshotPaths.add(relativePath)
    if (!basename(relativePath).startsWith(`${String(index + 1).padStart(2, "0")}-`)) {
      fail(`${platform} screenshot ${index + 1} does not encode its display order: ${relativePath}`)
    }
    if (!guide.includes(`\`${basename(relativePath)}\``)) {
      fail(`${relativePath} is not documented by filename in apple/LISTING.md`)
    }
    const extension = extname(relativePath).toLocaleLowerCase("en-US")
    if (![".png", ".jpg", ".jpeg"].includes(extension)) {
      fail(`${relativePath} is not a supported screenshot format`)
    }
  })

  const missing = set.paths.filter((relativePath) => !existsSync(storePath(relativePath)))
  if (set.status === "ready") {
    if (missing.length > 0) {
      missing.forEach((relativePath) => fail(`${platform} is ready but ${relativePath} is missing`))
    } else {
      for (const relativePath of set.paths) {
        const path = storePath(relativePath)
        const image = inspectImage(path)
        if (image === undefined) {
          fail(`${relativePath} is not a readable PNG or JPEG`)
          continue
        }
        const extension = extname(relativePath).toLocaleLowerCase("en-US")
        const expectedExtension = image.format === "png" ? ".png" : [".jpg", ".jpeg"]
        if (typeof expectedExtension === "string"
          ? extension !== expectedExtension
          : !expectedExtension.includes(extension)) {
          fail(`${relativePath} has ${image.format} bytes behind the wrong filename extension`)
        }
        const dimensions = `${image.width}x${image.height}`
        if (dimensions !== screenshotDimensions[platform]) {
          fail(`${relativePath} is ${dimensions}, expected ${screenshotDimensions[platform]}`)
        }
        if (image.hasAlpha) fail(`${relativePath} carries transparency; App Store screenshots must be opaque`)
      }
      pass(`${platform} has ${set.paths.length} ordered, opaque screenshots at ${screenshotDimensions[platform]}`)
    }
  } else if (set.status === "pending") {
    wait(`${platform} screenshots are pending (${set.paths.length - missing.length}/${set.paths.length} files present)`)
  } else {
    fail(`${platform} has invalid screenshot status ${JSON.stringify(set.status)}`)
  }
}

const hasPendingBanner = guide.includes("SCREENSHOTS PENDING - NOT READY FOR APP REVIEW")
const screenshotsPending = platformNames.some((platform) => listing.screenshots[platform]?.status === "pending")
if (screenshotsPending && !hasPendingBanner) fail("LISTING.md must carry the screenshot pending banner")
if (!screenshotsPending && hasPendingBanner) fail("LISTING.md still claims screenshots are pending")

console.log("")
if (failures > 0) {
  console.error(`Apple metadata audit failed: ${failures} problem${failures === 1 ? "" : "s"}.`)
  process.exit(1)
}

console.log(
  pending === 0
    ? "Apple metadata audit passed with no pending gates."
    : `Apple metadata audit passed; ${pending} documented screenshot gate${pending === 1 ? " is" : "s are"} pending.`
)
