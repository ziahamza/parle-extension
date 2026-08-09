/**
 * Proves the harness itself works: real Chrome, extension loaded, worker alive.
 * Run via `pnpm --filter @parle/extension e2e:smoke`.
 */
import { launch } from "./harness.ts"

const main = async () => {
  console.log("launching chrome with the extension…")
  const h = await launch()
  console.log(`  extension id: ${h.extensionId}`)
  console.log(`  service worker: ${h.worker.url()}`)

  const page = h.context.pages()[0] ?? (await h.context.newPage())
  await page.goto("https://news.ycombinator.com/", { waitUntil: "domcontentloaded" })
  console.log(`  loaded: ${await page.title()}`)

  const shot = await h.shot("smoke-hn")
  console.log(`  screenshot: ${shot}`)

  await h.close()
  console.log("OK")
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
