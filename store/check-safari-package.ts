import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(
  process.argv[2] ?? path.join(scriptDir, "../apps/extension/.output/safari-package")
)
const manifestPath = path.join(root, "manifest.json")
if (!fs.existsSync(manifestPath)) throw new Error(`Missing Safari manifest: ${manifestPath}`)

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const appleDescription = fs.readFileSync(
  path.join(scriptDir, "apple/manifest-description.txt"),
  "utf8"
).trimEnd()
const fail = (message: string) => {
  throw new Error(`Safari package audit failed: ${message}`)
}

if (manifest.name !== "Parle") fail(`name is ${JSON.stringify(manifest.name)}`)
if (manifest.description !== appleDescription) {
  fail(
    `description is ${JSON.stringify(manifest.description)}, ` +
    `apple/manifest-description.txt says ${JSON.stringify(appleDescription)}`
  )
}
if (Array.from(appleDescription).length > 112) fail("description exceeds Apple's 112-character limit")
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) {
  fail(`version is ${JSON.stringify(manifest.version)}`)
}
if (manifest.manifest_version !== 3) fail(`manifest_version is ${manifest.manifest_version}`)
if (manifest.background?.service_worker !== undefined) {
  fail("Chromium background.service_worker reached the Apple package")
}
if (JSON.stringify(manifest.background?.scripts) !== JSON.stringify(["background.js"])) {
  fail(`background scripts are ${JSON.stringify(manifest.background?.scripts)}`)
}
if (manifest.background?.type !== "module") fail("background module type is missing")
if (manifest.background?.persistent !== false) fail("background is not explicitly nonpersistent")
const permissions = [...(manifest.permissions ?? [])].sort()
const expectedPermissions = ["nativeMessaging", "scripting", "tabs", "webNavigation"].sort()
if (JSON.stringify(permissions) !== JSON.stringify(expectedPermissions)) {
  fail(`permissions are ${JSON.stringify(manifest.permissions)}, expected ${JSON.stringify(expectedPermissions)}`)
}
if (manifest.side_panel !== undefined) fail("Chrome side_panel entrypoint reached Safari")
if (manifest.key !== undefined) fail("Chrome extension key reached Safari")

for (const required of [
  "background.js",
  "popup.html",
  "options.html",
  "welcome.html",
  "content-scripts/pill.js",
  "content-scripts/harvest.js",
  "icon/128.png"
]) {
  if (!fs.existsSync(path.join(root, required))) fail(`missing ${required}`)
}

console.log(`Safari package audit passed: Parle ${manifest.version}, MV3, Apple background adapter`)
