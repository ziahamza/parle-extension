/**
 * Render the iOS/iPadOS App Store icon from the same vector mark as the browser
 * icon. Apple applies its own corner mask, so this 1024px source is deliberately
 * full-bleed and opaque instead of upscaling the browser icon's transparent,
 * already-rounded 512px raster.
 *
 * Run: pnpm tsx store/make-apple-icon.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const here = path.dirname(fileURLToPath(import.meta.url))
const destination = path.join(here, "apple/app-icon-1024.png")
const accent = "#ff6600"
const bubble =
  "M8 1.6c-3.6 0-6.5 2.3-6.5 5.2 0 1.7 1 3.2 2.5 4.1L3.3 14l3.2-1.7c.5.1 1 .1 1.5.1 3.6 0 6.5-2.3 6.5-5.2S11.6 1.6 8 1.6z"

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 128, height: 128 },
    deviceScaleFactor: 8
  })
  await page.setContent(
    `<!doctype html><meta charset="utf-8">` +
      `<style>html,body{margin:0;width:128px;height:128px;background:${accent}}</style>` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" fill="${accent}"/>` +
      `<g transform="translate(8.3 8.6) scale(3)">` +
      `<path d="${bubble}" fill="#ffffff"/></g></svg>`,
    { waitUntil: "load" }
  )
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  await page.screenshot({ path: destination, omitBackground: false })
  console.log(`Generated opaque Apple AppIcon: ${path.relative(process.cwd(), destination)}`)
} finally {
  await browser.close()
}
