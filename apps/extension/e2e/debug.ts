/** Ask the running extension what it thinks it is doing. */
import { launch } from "./harness.ts"

const main = async () => {
  const h = await launch()
  console.log(`extension ${h.extensionId}\n`)

  h.worker.on("console", (m) => console.log(`[worker:${m.type()}] ${m.text()}`))
  h.context.on("weberror", (e) => console.log(`[weberror] ${e.error().message}`))

  // Does the worker see requests at all from the context's point of view?
  const seen: Array<string> = []
  h.context.on("request", (r) => seen.push(`${r.serviceWorker() ? "SW " : "PG "}${r.url().slice(0, 90)}`))

  const page = h.context.pages()[0] ?? (await h.context.newPage())
  page.on("console", (m) => console.log(`[page:${m.type()}] ${m.text().slice(0, 200)}`))
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`))

  await page.goto("https://www.nature.com/articles/d41586-024-02012-5", { waitUntil: "domcontentloaded" })
  await new Promise((r) => setTimeout(r, 8000))

  console.log("\n--- manifest permissions ---")
  console.log(await h.worker.evaluate(() => JSON.stringify(chrome.runtime.getManifest().permissions)))

  console.log("\n--- can the worker reach Algolia itself? ---")
  const direct = await h.worker.evaluate(async () => {
    try {
      const r = await fetch("https://hn.algolia.com/api/v1/search?query=nature.com&restrictSearchableAttributes=url")
      const j = await r.json()
      return `status ${r.status}, nbHits ${j.nbHits}`
    } catch (e) {
      return `THREW: ${String(e)}`
    }
  })
  console.log(direct)

  console.log("\n--- what did the context observe? ---")
  const algolia = seen.filter((s) => s.includes("algolia"))
  console.log(`total ${seen.length} requests, ${algolia.length} to algolia`)
  algolia.slice(0, 5).forEach((s) => console.log("  " + s))

  console.log("\n--- badge ---")
  console.log(await h.worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true })
    const t = tabs[0]
    if (!t?.id) return "no tab"
    return `tab ${t.id} url=${t.url?.slice(0, 60)} badge="${await chrome.action.getBadgeText({ tabId: t.id })}"`
  }))

  await h.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
