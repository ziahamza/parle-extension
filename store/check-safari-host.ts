import { execFileSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertCustomizedProject,
  safariTargets
} from "../apps/extension/scripts/customize-safari-host.ts"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")
const extensionRoot = path.join(repoRoot, "apps/extension")
const appleRoot = path.join(extensionRoot, "apple")
const preparedRoot = path.join(extensionRoot, ".output/safari-package")
const teamIdentifier = "85A9MS6428"
const appIdentifier = "com.ziahamza.parle"
const extensionIdentifier = "com.ziahamza.parle.Extension"
const portalAppGroup = "group.com.ziahamza.parle.shared"

type ExportedPlatform = "ios" | "macos"

interface ExportedArtifact {
  readonly platform: ExportedPlatform
  readonly artifact: string
}

const fail = (message: string): never => {
  throw new Error(`Safari host audit failed: ${message}`)
}

const expect: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) fail(message)
}

const argumentsAfterScript = process.argv.slice(2)
let projectRoot: string | undefined
const builtProducts: Array<string> = []
const exportedArtifacts: Array<ExportedArtifact> = []
let expectedVersion: string | undefined
let expectedBuild: string | undefined
for (let at = 0; at < argumentsAfterScript.length; at += 1) {
  const argument = argumentsAfterScript[at]
  if (argument === "--built-product") {
    const product = argumentsAfterScript[at + 1]
    expect(product !== undefined, "--built-product needs a .app path")
    builtProducts.push(path.resolve(product))
    at += 1
  } else if (argument === "--exported-ipa" || argument === "--exported-pkg") {
    const artifact = argumentsAfterScript[at + 1]
    expect(artifact !== undefined, `${argument} needs an artifact path`)
    exportedArtifacts.push({
      platform: argument === "--exported-ipa" ? "ios" : "macos",
      artifact: path.resolve(artifact)
    })
    at += 1
  } else if (argument === "--expected-version" || argument === "--expected-build") {
    const value = argumentsAfterScript[at + 1]
    expect(value !== undefined && value.length > 0, `${argument} needs a value`)
    if (argument === "--expected-version") expectedVersion = value
    else expectedBuild = value
    at += 1
  } else {
    expect(argument !== undefined && !argument.startsWith("--"), `unknown argument ${argument}`)
    expect(projectRoot === undefined, "pass at most one generated project directory")
    projectRoot = path.resolve(argument)
  }
}
projectRoot ??= path.join(extensionRoot, ".output/safari-apple/Parle")

const sameFile = (canonical: string, generated: string): void => {
  expect(fs.existsSync(canonical), `missing checked-in overlay ${canonical}`)
  expect(fs.existsSync(generated), `missing generated overlay ${generated}`)
  expect(fs.readFileSync(canonical).equals(fs.readFileSync(generated)),
    `${generated} differs from ${canonical}`)
}

const expectedCopies: ReadonlyArray<readonly [string, string]> = [
  ["ViewController.swift", "Shared (App)/ViewController.swift"],
  ["SafariWebExtensionHandler.swift", "Shared (Extension)/SafariWebExtensionHandler.swift"],
  ["iOS-App.entitlements", "iOS (App)/Parle.entitlements"],
  ["iOS-Extension.entitlements", "iOS (Extension)/Parle.entitlements"],
  ["macOS-App.entitlements", "macOS (App)/Parle.entitlements"],
  ["macOS-Extension.entitlements", "macOS (Extension)/Parle.entitlements"],
  ["PrivacyInfo.xcprivacy", "Shared (App)/PrivacyInfo.xcprivacy"],
  ["PrivacyInfo.xcprivacy", "Shared (Extension)/PrivacyInfo.xcprivacy"]
]

for (const [canonical, generated] of expectedCopies) {
  sameFile(path.join(appleRoot, canonical), path.join(projectRoot, generated))
}

const projectPath = path.join(projectRoot, "Parle.xcodeproj/project.pbxproj")
expect(fs.existsSync(projectPath), `missing generated project ${projectPath}`)
const project = fs.readFileSync(projectPath, "utf8")
assertCustomizedProject(project)

const handler = fs.readFileSync(path.join(appleRoot, "SafariWebExtensionHandler.swift"), "utf8")
for (const required of [
  'case "recordOpening"',
  'case "clearRecentOpenings"',
  'schemaVersion(command["schemaVersion"]) == RecentOpeningsStore.schemaVersion',
  "SFExtensionProfileKey",
  'static let maximumOpenings = 100',
  'static let clearedBeforeKey = "recent-openings-cleared-before-v1"',
  'static let profileClearedBeforeKey = "recent-openings-profile-cleared-before-v1"',
  'static let retentionMilliseconds = 30.0 * 24.0 * 60.0 * 60.0 * 1_000.0',
  'var identity: String { "\\(profileID)\\u{0}\\(subject)" }',
  'for raw in rawDiscussions',
  'if opening.openedAt <= clearedBefore(defaults, profileID: profileID)',
  'let requestedAt = finiteNumber(command["clearedAt"])',
  'let boundary = max(existingBoundary, requestedAt)',
  'opening.merging(existing: held)',
  'withRecentOpeningsLock',
  'flock(descriptor, LOCK_EX)',
  '.recent-openings.lock',
  "byIdentity[candidate.identity]",
  "discussion.merging(existing: held)",
  "preferredText(archiveURL, existing.archiveURL)",
  ".prefix(RecentOpeningsStore.maximumOpenings)",
  '85A9MS6428.com.ziahamza.parle.shared',
  'group.com.ziahamza.parle.shared'
]) {
  expect(handler.includes(required), `native handler lost ${JSON.stringify(required)}`)
}
for (const forbidden of [
  "maximumDiscussions",
  "rawDiscussions.count <",
  "rawDiscussions.count >",
  "rawDiscussions.prefix("
]) {
  expect(!handler.includes(forbidden), `native handler no longer keeps every Discussion: ${forbidden}`)
}
for (const forbidden of ["NSLog", "os_log", "Logger", "debugPrint(", "dump(", "print("]) {
  expect(!handler.includes(forbidden), `native handler may log a private payload through ${forbidden}`)
}

const viewController = fs.readFileSync(path.join(appleRoot, "ViewController.swift"), "utf8")
expect(viewController.includes('extensionBundleIdentifier = "com.ziahamza.parle.Extension"'),
  "ViewController does not use the registered extension App ID")
expect(!viewController.includes("com.ziahamza.Parle"),
  "ViewController contains the converter's unregistered bundle-ID casing")
for (const required of [
  'static let clearedBeforeKey = "recent-openings-cleared-before-v1"',
  'static let profileClearedBeforeKey = "recent-openings-profile-cleared-before-v1"',
  'opening.openedAt.timeIntervalSince1970 * 1_000 > clearedBefore(opening.profileID)',
  'forKey: SharedRecentOpenings.clearedBeforeKey',
  'defaults.removeObject(forKey: SharedRecentOpenings.profileClearedBeforeKey)',
  'withRecentOpeningsLock',
  'flock(descriptor, LOCK_EX)',
  '.recent-openings.lock'
]) {
  expect(viewController.includes(required), `companion clear watermark lost ${JSON.stringify(required)}`)
}

const privacy = fs.readFileSync(path.join(appleRoot, "PrivacyInfo.xcprivacy"), "utf8")
for (const required of [
  "NSPrivacyAccessedAPICategoryUserDefaults",
  "1C8F.1",
  "NSPrivacyCollectedDataTypes",
  "NSPrivacyTracking",
  "<false/>"
]) {
  expect(privacy.includes(required), `PrivacyInfo.xcprivacy lost ${required}`)
}

const entitlementGroups: ReadonlyArray<readonly [string, string]> = [
  ["iOS-App.entitlements", "group.com.ziahamza.parle.shared"],
  ["iOS-Extension.entitlements", "group.com.ziahamza.parle.shared"],
  ["macOS-App.entitlements", "85A9MS6428.com.ziahamza.parle.shared"],
  ["macOS-Extension.entitlements", "85A9MS6428.com.ziahamza.parle.shared"]
]
for (const [file, group] of entitlementGroups) {
  const contents = fs.readFileSync(path.join(appleRoot, file), "utf8")
  expect(contents.includes("com.apple.security.application-groups"), `${file} has no App Group entitlement`)
  expect(contents.includes(group), `${file} has the wrong App Group`)
}

expect(safariTargets.length === 4, `expected four native targets, found ${safariTargets.length}`)

const directoriesNamed = (root: string, suffix: string): ReadonlyArray<string> => {
  const found: Array<string> = []
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = path.join(directory, entry.name)
      if (entry.name.endsWith(suffix)) found.push(child)
      else visit(child)
    }
  }
  visit(root)
  return found
}

const oneExisting = (candidates: ReadonlyArray<string>, description: string): string => {
  const held = candidates.filter((candidate) => fs.existsSync(candidate))
  expect(held.length === 1, `${description}: expected one path, found ${held.length}`)
  return held[0] ?? fail(`${description}: missing path`)
}

const plistValue = (plist: string, key: string): string => {
  try {
    return execFileSync("plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).trim()
  } catch {
    return fail(`${plist} has no readable ${key}`)
  }
}

const verifyBundle = (bundle: string, expectedIdentifier: string): void => {
  const manifest = oneExisting([
    path.join(bundle, "PrivacyInfo.xcprivacy"),
    path.join(bundle, "Contents/Resources/PrivacyInfo.xcprivacy")
  ], `${bundle} privacy manifest`)
  sameFile(path.join(appleRoot, "PrivacyInfo.xcprivacy"), manifest)
  const info = oneExisting([
    path.join(bundle, "Info.plist"),
    path.join(bundle, "Contents/Info.plist")
  ], `${bundle} Info.plist`)
  expect(plistValue(info, "ITSAppUsesNonExemptEncryption") === "false",
    `${bundle} does not declare ITSAppUsesNonExemptEncryption=false`)
  expect(plistValue(info, "CFBundleIdentifier") === expectedIdentifier,
    `${bundle} has bundle identifier ${plistValue(info, "CFBundleIdentifier")}`)
  if (expectedVersion !== undefined) {
    expect(plistValue(info, "CFBundleShortVersionString") === expectedVersion,
      `${bundle} has marketing version ${plistValue(info, "CFBundleShortVersionString")}, expected ${expectedVersion}`)
  }
  if (expectedBuild !== undefined) {
    expect(plistValue(info, "CFBundleVersion") === expectedBuild,
      `${bundle} has build number ${plistValue(info, "CFBundleVersion")}, expected ${expectedBuild}`)
  }
}

const filesBelow = (root: string): ReadonlyArray<string> => {
  const found: Array<string> = []
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile()) found.push(child)
    }
  }
  visit(root)
  return found
}

const verifyWebExtensionResources = (bundle: string): void => {
  expect(fs.existsSync(preparedRoot), `missing prepared Safari Web Extension ${preparedRoot}`)
  const manifest = oneExisting([
    path.join(bundle, "manifest.json"),
    path.join(bundle, "Contents/Resources/manifest.json")
  ], `${bundle} Web Extension manifest`)
  const resources = path.dirname(manifest)
  for (const canonical of filesBelow(preparedRoot)) {
    const relative = path.relative(preparedRoot, canonical)
    sameFile(canonical, path.join(resources, relative))
  }
}

const escapedPlistPath = (segments: ReadonlyArray<string>): string => segments
  .map((segment) => segment.replaceAll("\\", "\\\\").replaceAll(".", "\\."))
  .join(".")

const plistExtract = (
  plist: string,
  segments: ReadonlyArray<string>,
  format: "json" | "raw"
): string | undefined => {
  try {
    return execFileSync(
      "plutil",
      ["-extract", escapedPlistPath(segments), format, "-o", "-", "-"],
      { encoding: "utf8", input: plist, stdio: ["pipe", "pipe", "pipe"] }
    ).trim()
  } catch {
    return undefined
  }
}

const requiredPlistString = (
  plist: string,
  segments: ReadonlyArray<string>,
  description: string
): string => {
  const value = plistExtract(plist, segments, "raw")
  expect(value !== undefined && value.length > 0, `${description} is missing`)
  return value
}

const requiredPlistStrings = (
  plist: string,
  segments: ReadonlyArray<string>,
  description: string
): ReadonlyArray<string> => {
  const value = plistExtract(plist, segments, "json")
  expect(value !== undefined, `${description} is missing`)
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch {
    return fail(`${description} is not a JSON array`)
  }
  expect(Array.isArray(decoded), `${description} is not an array`)
  const strings = decoded.filter((item): item is string => typeof item === "string")
  expect(strings.length === decoded.length, `${description} contains a non-string value`)
  return strings
}

const exactly = (actual: ReadonlyArray<string>, expected: string, description: string): void => {
  expect(actual.length === 1 && actual[0] === expected,
    `${description} is ${JSON.stringify(actual)}, expected [${JSON.stringify(expected)}]`)
}

const commandOutput = (command: string, args: ReadonlyArray<string>, description: string): string => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
  } catch (error) {
    return fail(`${description}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const signatureDetails = (bundle: string): string => {
  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", bundle], {
      stdio: ["ignore", "pipe", "pipe"]
    })
  } catch (error) {
    return fail(`${bundle} signature is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }

  // codesign writes display details to stderr even on success.
  const shown = spawnSync("codesign", ["-d", "--verbose=4", bundle], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
  expect(shown.error === undefined && shown.status === 0,
    `${bundle} signing details are unreadable: ${shown.error?.message ?? shown.stderr}`)
  expect(shown.stderr.length > 0, `${bundle} signing details were unexpectedly empty`)
  return shown.stderr
}

const signedEntitlements = (bundle: string): string => commandOutput(
  "codesign",
  ["-d", "--entitlements", ":-", bundle],
  `${bundle} signed entitlements are unreadable`
)

const embeddedProfile = (bundle: string, platform: ExportedPlatform): string => oneExisting(
  platform === "ios"
    ? [path.join(bundle, "embedded.mobileprovision")]
    : [
        path.join(bundle, "Contents/embedded.provisionprofile"),
        path.join(bundle, "Contents/embedded.mobileprovision")
      ],
  `${bundle} embedded provisioning profile`
)

const expectedProfileName = (
  platform: ExportedPlatform,
  expectedIdentifier: string
): string => {
  const subject = expectedIdentifier === appIdentifier ? "Parle" : "Parle Extension"
  return `${subject} ${platform === "ios" ? "iOS" : "Mac"} App Store`
}

const verifyProvisioningProfile = (
  bundle: string,
  platform: ExportedPlatform,
  expectedIdentifier: string,
  expectedGroup: string
): void => {
  const profilePath = embeddedProfile(bundle, platform)
  const profile = commandOutput(
    "security",
    ["cms", "-D", "-i", profilePath],
    `${profilePath} cannot be decoded`
  )
  exactly(requiredPlistStrings(profile, ["TeamIdentifier"], `${profilePath} TeamIdentifier`),
    teamIdentifier, `${profilePath} TeamIdentifier`)
  exactly(requiredPlistStrings(profile, ["ApplicationIdentifierPrefix"], `${profilePath} app ID prefix`),
    teamIdentifier, `${profilePath} app ID prefix`)
  expect(requiredPlistString(profile, ["Name"], `${profilePath} Name`) ===
    expectedProfileName(platform, expectedIdentifier), `${profilePath} is not the selected App Store profile`)
  requiredPlistString(profile, ["UUID"], `${profilePath} UUID`)
  requiredPlistString(profile, ["ExpirationDate"], `${profilePath} expiration`)
  expect(plistExtract(profile, ["ProvisionedDevices"], "json") === undefined,
    `${profilePath} is device-provisioned rather than App Store distribution`)
  expect(plistExtract(profile, ["ProvisionsAllDevices"], "raw") !== "true",
    `${profilePath} is an all-device profile rather than App Store distribution`)
  const profileGetTaskAllow = plistExtract(profile, ["Entitlements", "get-task-allow"], "raw")
  expect(profileGetTaskAllow === undefined || profileGetTaskAllow === "false",
    `${profilePath} enables debugging`)
  const profileApplicationIdentifier = platform === "ios" ? "application-identifier" : "com.apple.application-identifier"
  expect(requiredPlistString(profile, ["Entitlements", profileApplicationIdentifier],
    `${profilePath} application identifier`) === `${teamIdentifier}.${expectedIdentifier}`,
  `${profilePath} is provisioned for the wrong application identifier`)
  const profileGroups = requiredPlistStrings(
    profile,
    ["Entitlements", "com.apple.security.application-groups"],
    `${profilePath} App Groups`
  )
  if (platform === "ios") {
    exactly(profileGroups, expectedGroup, `${profilePath} App Groups`)
  } else {
    // Apple's macOS App Store profile represents the portal App Group by its
    // group.* identifier and authorizes the legacy team-prefixed signed
    // entitlement through TEAM_ID.*. The exported signature must still carry
    // the one narrow, concrete group checked in verifySignedBundle above.
    expect(profileGroups.includes(portalAppGroup),
      `${profilePath} does not contain portal App Group ${portalAppGroup}`)
    expect(profileGroups.some((group) => group.endsWith("*")
      ? expectedGroup.startsWith(group.slice(0, -1))
      : group === expectedGroup), `${profilePath} does not authorize signed App Group ${expectedGroup}`)
  }
}

const verifySignedBundle = (
  bundle: string,
  platform: ExportedPlatform,
  expectedIdentifier: string,
  expectedGroup: string
): void => {
  verifyBundle(bundle, expectedIdentifier)
  const details = signatureDetails(bundle)
  expect(details.includes(`TeamIdentifier=${teamIdentifier}`),
    `${bundle} was not signed by team ${teamIdentifier}`)
  expect(/Authority=(?:Apple Distribution|iPhone Distribution|3rd Party Mac Developer Application):/.test(details),
    `${bundle} is not signed with an App Store distribution certificate`)

  const entitlements = signedEntitlements(bundle)
  exactly(requiredPlistStrings(entitlements, ["com.apple.security.application-groups"],
    `${bundle} signed App Groups`), expectedGroup, `${bundle} signed App Groups`)
  expect(requiredPlistString(entitlements, ["com.apple.developer.team-identifier"],
    `${bundle} signed team identifier`) === teamIdentifier, `${bundle} has the wrong signed team identifier`)
  const signedApplicationIdentifier = platform === "ios" ? "application-identifier" : "com.apple.application-identifier"
  expect(requiredPlistString(entitlements, [signedApplicationIdentifier],
    `${bundle} signed application identifier`) === `${teamIdentifier}.${expectedIdentifier}`,
  `${bundle} has the wrong signed application identifier`)
  expect(plistExtract(entitlements, ["get-task-allow"], "raw") !== "true",
    `${bundle} signed entitlements enable debugging`)
  if (platform === "macos") {
    expect(requiredPlistString(entitlements, ["com.apple.security.app-sandbox"],
      `${bundle} app sandbox entitlement`) === "true", `${bundle} is not sandboxed`)
  }
  verifyProvisioningProfile(bundle, platform, expectedIdentifier, expectedGroup)
}

const verifyProduct = (product: string, signedPlatform?: ExportedPlatform): void => {
  expect(fs.existsSync(product) && fs.statSync(product).isDirectory(),
    `built product is not a directory: ${product}`)
  expect(product.endsWith(".app"), `built product is not an app bundle: ${product}`)
  const expectedGroup = signedPlatform === "macos"
    ? `${teamIdentifier}.com.ziahamza.parle.shared`
    : portalAppGroup
  if (signedPlatform === undefined) verifyBundle(product, appIdentifier)
  else verifySignedBundle(product, signedPlatform, appIdentifier, expectedGroup)
  const extensions = directoriesNamed(product, ".appex")
  expect(extensions.length === 1, `${product} contains ${extensions.length} extension bundles`)
  const extension = extensions[0] ?? fail(`${product} has no extension bundle`)
  if (signedPlatform === undefined) verifyBundle(extension, extensionIdentifier)
  else {
    verifySignedBundle(extension, signedPlatform, extensionIdentifier, expectedGroup)
    verifyWebExtensionResources(extension)
  }
  if (signedPlatform === "ios") {
    const appIcons = fs.readdirSync(product, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^AppIcon.*[.]png$/.test(entry.name))
      .map((entry) => path.join(product, entry.name))
    expect(appIcons.length > 0, `${product} contains no compiled iOS app icons`)
    for (const icon of appIcons) {
      const properties = commandOutput("sips", ["-g", "hasAlpha", icon], `${icon} cannot be inspected`)
      expect(/hasAlpha: no(?:\s|$)/.test(properties), `${icon} has an alpha channel`)
    }
  }
}

const verifyExportedArtifact = ({ platform, artifact }: ExportedArtifact): void => {
  expect(fs.existsSync(artifact) && fs.statSync(artifact).isFile(),
    `exported artifact is not a file: ${artifact}`)
  expect(artifact.endsWith(platform === "ios" ? ".ipa" : ".pkg"),
    `${artifact} has the wrong extension for ${platform}`)
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), `parle-${platform}-audit-`))
  try {
    if (platform === "ios") {
      commandOutput("ditto", ["-x", "-k", artifact, extracted], `${artifact} cannot be extracted`)
    } else {
      const signature = commandOutput("pkgutil", ["--check-signature", artifact],
        `${artifact} installer signature is invalid`)
      expect(/Status: signed/.test(signature), `${artifact} is not a signed installer package`)
      expect(/3rd Party Mac Developer Installer|Mac Installer Distribution/.test(signature),
        `${artifact} is not signed for Mac App Store installation`)
      const expanded = path.join(extracted, "expanded")
      commandOutput("pkgutil", ["--expand-full", artifact, expanded], `${artifact} cannot be expanded`)
    }
    const applications = directoriesNamed(extracted, ".app")
    expect(applications.length === 1,
      `${artifact} contains ${applications.length} top-level application bundles`)
    verifyProduct(applications[0] ?? fail(`${artifact} contains no application bundle`), platform)
  } finally {
    fs.rmSync(extracted, { force: true, recursive: true })
  }
}

for (const product of builtProducts) {
  verifyProduct(product)
}
for (const artifact of exportedArtifacts) {
  verifyExportedArtifact(artifact)
}

console.log(
  `Safari host audit passed: four targets, App Groups, native recents, privacy manifests${
    builtProducts.length === 0 ? "" : `, ${builtProducts.length} built product(s)`
  }${
    exportedArtifacts.length === 0 ? "" : `, ${exportedArtifacts.length} signed export(s)`
  }`
)
