import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDir, "..")
const source = path.resolve(process.argv[2] ?? path.join(extensionRoot, ".output/safari-mv3"))
const prepared = path.resolve(process.argv[3] ?? path.join(extensionRoot, ".output/safari-package"))
const archive = path.resolve(
  process.argv[4] ?? path.join(extensionRoot, ".output/parle-safari-web-extension.zip")
)

const manifestPath = path.join(source, "manifest.json")
if (!fs.existsSync(manifestPath)) {
  throw new Error(`Safari build is missing ${manifestPath}. Run wxt build -b safari first.`)
}

fs.rmSync(prepared, { recursive: true, force: true })
fs.cpSync(source, prepared, { recursive: true })

const preparedManifestPath = path.join(prepared, "manifest.json")
const manifest = JSON.parse(fs.readFileSync(preparedManifestPath, "utf8"))
const worker = manifest.background?.service_worker
if (typeof worker !== "string" || worker === "") {
  throw new Error("Expected WXT's Safari MV3 build to declare background.service_worker")
}

/**
 * Safari 26's web-extension packager and WWDC26 guidance use a nonpersistent
 * module background declared with `scripts`, while Chromium MV3 uses
 * `service_worker`. WXT deliberately emits the portable Chromium shape so the
 * Safari branch can still run in the real-Chrome battery. The distributable
 * adapter is the right seam for the one manifest spelling Apple owns.
 */
manifest.background = {
  scripts: [worker],
  type: manifest.background.type ?? "module",
  // Required on iOS/iPadOS. MV3 backgrounds are nonpersistent by definition,
  // but Apple's packager still audits the explicit declaration on `scripts`.
  persistent: false
}

fs.writeFileSync(preparedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
fs.rmSync(archive, { force: true })
execFileSync("zip", ["-q", "-r", archive, "."], { cwd: prepared, stdio: "inherit" })

console.log(`Prepared Safari Web Extension: ${prepared}`)
console.log(`App Store Connect upload: ${archive}`)
