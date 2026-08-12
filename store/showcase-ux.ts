/**
 * Visual showcase of the on-page mark and Network-native conversation themes.
 *
 * Not a behaviour test — a set of frames a human (or a PR) can look at. Uses the
 * same stylesheet the product injects, so what you see here is what ships.
 *
 * Run: `pnpm tsx store/showcase-ux.ts`
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { PANEL_STYLES } from "../apps/extension/src/view/styles.ts"

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = process.env["PARLE_SHOWCASE_OUT"]
  ?? path.resolve("/opt/cursor/artifacts")

const HN_Y =
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect width="16" height="16" rx="2.5" fill="#ff6600"/><path d="M4.2 3.2h1.7l2.1 4.1 2.1-4.1h1.7L8.9 8.6V12.8H7.1V8.6L4.2 3.2z" fill="#fff"/></svg>`
const REDDIT =
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#ff4500"/><text x="8" y="11.2" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="700" font-family="Verdana, Geneva, sans-serif">r/</text></svg>`
const X_MARK =
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#0f1419"/><path d="M4.1 4.1h2.05l1.7 2.35L10.05 4.1H12l-2.85 3.55L12.2 11.9h-2.05l-1.95-2.6-2.2 2.6H4l3.1-3.7L4.1 4.1z" fill="#fff"/></svg>`

const stack = (networks: ReadonlyArray<"hn" | "reddit" | "x">, count: number): string => {
  // Back-to-front, matching `stackFace`: first Network ends up on top.
  const discs = [...networks].reverse().map((network) => {
    const glyph = network === "hn" ? HN_Y : network === "reddit" ? REDDIT : X_MARK
    return `<span class="parle-stack-disc">${glyph}</span>`
  }).join("")
  return (
    `<button class="parle-pill" type="button" style="position:relative;top:auto;right:auto;left:auto">` +
    `<span class="parle-stack" data-count="${networks.length}">${discs}</span>` +
    `<span class="parle-pill-count">${count}</span></button>`
  )
}

const SHORT = { hackernews: "HN", reddit: "Reddit", x: "X" } as const

const tab = (
  network: "hackernews" | "reddit" | "x",
  count: number,
  on: boolean,
  label?: string
): string => {
  const glyph = network === "hackernews" ? HN_Y : network === "reddit" ? REDDIT : X_MARK
  const name = label ?? SHORT[network]
  return (
    `<button class="parle-tab${on ? " parle-tab-on" : ""}" data-network="${network}" type="button">` +
    `<span class="parle-tab-mark">${glyph}</span>` +
    `<span class="parle-tab-name">${name}</span>` +
    `<span class="parle-tab-count" aria-hidden="true">${count}</span></button>`
  )
}

const conversation = (
  network: "hackernews" | "reddit" | "x",
  where: string | null,
  title: string,
  facts: string,
  comments: ReadonlyArray<{ who: string; text: string }>,
  tabsHtml: string
): string => {
  const said = comments.map((comment) => (
    `<article class="parle-comment">` +
    `<div class="parle-comment-who">${comment.who}</div>` +
    `<p class="parle-comment-text">${comment.text}</p></article>`
  )).join("")
  const place = where === null ? "" : `<div class="parle-post-place">${where}</div>`
  return `
<section class="parle-group parle-group-linked parle-group-talk" data-network="${network}">
  <h2 class="parle-group-name">About this page</h2>
  <div class="parle-talk">
    <div class="parle-tabs"><div class="parle-tabs-strip" role="tablist">${tabsHtml}</div></div>
    <div class="parle-conversation" data-network="${network}">
      <div class="parle-row-holder parle-home">
        <div class="parle-row parle-post">
          ${place}
          <a class="parle-title" href="#">${title}</a>
          <div class="parle-facts">${facts}</div>
        </div>
        <div class="parle-comments">${said}</div>
      </div>
    </div>
  </div>
</section>`
}

const pageShell = (body: string, width: number, height: number): string => `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    background:
      radial-gradient(1200px 600px at 10% -10%, #dfe8ff 0%, transparent 55%),
      radial-gradient(900px 500px at 100% 0%, #ffe8d6 0%, transparent 50%),
      #f7f4ee;
    color: #1b1f24;
  }
  .article {
    max-width: 640px; margin: 48px 56px; line-height: 1.55;
  }
  .article h1 { font-size: 34px; letter-spacing: -0.02em; margin: 0 0 12px; }
  .article p { font-size: 17px; color: #3a414c; }
  .stage {
    position: absolute; inset: 0; pointer-events: none;
  }
  .label {
    font: 600 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0.08em; text-transform: uppercase; color: #5b6270;
    margin: 0 0 10px;
  }
  .card {
    background: rgba(255,255,255,0.72); backdrop-filter: blur(8px);
    border: 1px solid rgba(20,22,26,0.08); border-radius: 16px;
    padding: 18px 18px 20px; box-shadow: 0 10px 40px rgba(10,12,16,0.08);
  }
  .marks { display: flex; gap: 28px; align-items: flex-end; }
  .mark-slot { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .mark-slot span.cap {
    font: 500 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #5b6270;
  }
  .panel-frame {
    width: 380px; height: 520px; overflow: hidden;
    border-radius: 14px; box-shadow: 0 16px 48px rgba(10,12,16,0.16);
  }
  .panels { display: flex; gap: 18px; align-items: stretch; }
  ${PANEL_STYLES}
  .parle-pill::after { animation: none; opacity: 0; }
  .parle-pill { animation: none; }
</style>
${body}`

const frames: Array<{ name: string; width: number; height: number; body: string }> = [
  {
    name: "01-stacked-marks",
    width: 1100,
    height: 640,
    body: `
      <div class="article">
        <h1>What the internet already said</h1>
        <p>Parle’s mark is no longer a mute bubble in the corner. It stacks the
        Networks that are talking — drag it anywhere; it remembers.</p>
      </div>
      <div style="position:absolute;left:56px;bottom:56px;right:56px">
        <div class="card">
          <p class="label">On-page mark</p>
          <div class="marks">
            <div class="mark-slot">${stack(["hn"], 3)}<span class="cap">Hacker News</span></div>
            <div class="mark-slot">${stack(["hn", "reddit"], 12)}<span class="cap">HN + Reddit</span></div>
            <div class="mark-slot">${stack(["hn", "reddit", "x"], 28)}<span class="cap">Full stack</span></div>
            <div class="mark-slot" style="margin-left:auto;align-items:flex-end">
              <div style="position:relative;width:220px;height:120px;border:1px dashed rgba(20,22,26,0.18);border-radius:12px;background:rgba(255,255,255,0.45)">
                <div style="position:absolute;right:16px;top:16px">${stack(["hn", "reddit"], 7)}</div>
                <div style="position:absolute;left:24px;bottom:20px">${stack(["reddit"], 4)}</div>
                <div style="position:absolute;right:48px;bottom:28px">${stack(["hn", "x"], 9)}</div>
              </div>
              <span class="cap">Draggable — park it where it stays out of the way</span>
            </div>
          </div>
        </div>
      </div>`
  },
  {
    name: "02-network-homes",
    width: 1280,
    height: 720,
    body: `
      <div style="padding:28px 28px 0">
        <p class="label">Browser tabs · short labels · Network rooms · blue accent</p>
        <h1 style="font:700 28px/1.2 Georgia, serif;margin:0 0 18px;letter-spacing:-0.02em">
          Pick a room. It should feel like that Network.
        </h1>
        <div class="panels">
          <div class="panel-frame">
            <div class="parle" style="height:100%">
              <header class="parle-head">
                <h1 class="parle-heading">A measured look at cold fusion claims</h1>
                <div class="parle-address">https://example.com/fusion</div>
              </header>
              <div class="parle-body">
                ${conversation(
                  "hackernews",
                  null,
                  "Cold fusion paper — the comments are doing the science",
                  `<span class="parle-network">Hacker News</span><span>412 points</span><span>186 comments</span><span>6h</span>`,
                  [
                    { who: "pg", text: "The interesting bit is the calorimetry, not the press release." },
                    { who: "dang", text: "Please keep it substantive — this is getting heated." }
                  ],
                  tab("hackernews", 186, true) + tab("reddit", 840, false, "r/science") + tab("x", 220, false)
                )}
              </div>
            </div>
          </div>
          <div class="panel-frame">
            <div class="parle" style="height:100%">
              <header class="parle-head">
                <h1 class="parle-heading">A measured look at cold fusion claims</h1>
                <div class="parle-address">https://example.com/fusion</div>
              </header>
              <div class="parle-body">
                ${conversation(
                  "reddit",
                  "r/science",
                  "Peer commentary on the same preprint",
                  `<span class="parle-network">Reddit</span><span>2.4k upvotes</span><span>840 comments</span><span>3h</span>`,
                  [
                    { who: "u/labcoat", text: "Figure 3’s error bars are doing a lot of work here." },
                    { who: "u/skeptic", text: "Replication or it didn’t happen — still, glad this is public." }
                  ],
                  tab("hackernews", 186, false) +
                    tab("reddit", 840, true, "r/science") +
                    tab("reddit", 41, false, "r/MachineLearning")
                )}
              </div>
            </div>
          </div>
          <div class="panel-frame">
            <div class="parle" style="height:100%">
              <header class="parle-head">
                <h1 class="parle-heading">A measured look at cold fusion claims</h1>
                <div class="parle-address">https://example.com/fusion</div>
              </header>
              <div class="parle-body">
                ${conversation(
                  "x",
                  null,
                  "Thread: the preprint just dropped",
                  `<span class="parle-network">X</span><span>1.1k likes</span><span>220 replies</span><span>1h</span>`,
                  [
                    { who: "@physicshq", text: "Reading now. The apparatus diagram is clearer than the abstract." },
                    { who: "@meterologist", text: "Not my field — but the tone in replies is unusually careful." }
                  ],
                  tab("hackernews", 186, false) + tab("reddit", 840, false, "r/science") + tab("x", 220, true)
                )}
              </div>
            </div>
          </div>
        </div>
      </div>`
  },
  {
    name: "03-in-situ",
    width: 1200,
    height: 740,
    body: `
      <div class="article" style="max-width:520px">
        <h1>Antikythera mechanism</h1>
        <p>The Antikythera mechanism is an Ancient Greek hand-powered orrery,
        described as the oldest known example of an analogue computer used to
        predict astronomical positions and eclipses decades in advance.</p>
        <p>Parle notices the discussions already underway — and shows you which
        Networks are talking before you open anything.</p>
      </div>
      <div class="stage">
        <div style="position:absolute;right:28px;top:28px">${stack(["hn", "reddit"], 5)}</div>
        <div class="panel-frame" style="position:absolute;right:0;top:0;bottom:0;height:auto;width:400px;border-radius:0;box-shadow:-12px 0 40px rgba(10,12,16,0.14)">
          <div class="parle" style="height:100%">
            <header class="parle-head">
              <h1 class="parle-heading">Antikythera mechanism</h1>
              <div class="parle-address">https://en.wikipedia.org/wiki/Antikythera_mechanism</div>
            </header>
            <div class="parle-body">
              ${conversation(
                "hackernews",
                null,
                "The Antikythera mechanism — still rewriting the history of computing",
                `<span class="parle-network">Hacker News</span><span>892 points</span><span>311 comments</span><span>2d</span>`,
                [
                  { who: "ancient", text: "Every few years a new CT scan forces another rewrite of the gear train." },
                  { who: "compiler", text: "It is hard to overstate how modern the differential gearing looks." }
                ],
                tab("hackernews", 311, true) +
                  tab("reddit", 88, false, "r/history") +
                  tab("reddit", 24, false, "r/AskHistorians")
              )}
            </div>
            <footer class="parle-footer">
              <div class="parle-footer-row">
                <button class="parle-link">Pause on en.wikipedia.org</button>
                <button class="parle-link">Settings</button>
              </div>
            </footer>
          </div>
        </div>
      </div>`
  }
]

const main = async (): Promise<void> => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const frame of frames) {
      const page = await browser.newPage({
        viewport: { width: frame.width, height: frame.height },
        deviceScaleFactor: 2
      })
      await page.setContent(pageShell(frame.body, frame.width, frame.height), {
        waitUntil: "load"
      })
      const file = path.join(OUT, `${frame.name}.png`)
      await page.screenshot({ path: file })
      await page.close()
      console.log(`  wrote ${path.relative(process.cwd(), file)}`)
    }
  } finally {
    await browser.close()
  }
  // Also copy into the store folder for the PR checkout.
  const local = path.join(here, "showcase")
  fs.mkdirSync(local, { recursive: true })
  for (const frame of frames) {
    fs.copyFileSync(path.join(OUT, `${frame.name}.png`), path.join(local, `${frame.name}.png`))
  }
  console.log(`  copied to ${path.relative(process.cwd(), local)}/`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
