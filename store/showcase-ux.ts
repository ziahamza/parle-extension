/**
 * Visual showcase of the compact comments-first redesign.
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
  `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><rect width="16" height="16" rx="2.5" fill="#ff6600"/><path d="M4.2 3.2h1.7l2.1 4.1 2.1-4.1h1.7L8.9 8.6V12.8H7.1V8.6L4.2 3.2z" fill="#fff"/></svg>`
const REDDIT =
  `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#ff4500"/><text x="8" y="11.2" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="700" font-family="Verdana, Geneva, sans-serif">r/</text></svg>`
const X_MARK =
  `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#0f1419"/><path d="M4.1 4.1h2.05l1.7 2.35L10.05 4.1H12l-2.85 3.55L12.2 11.9h-2.05l-1.95-2.6-2.2 2.6H4l3.1-3.7L4.1 4.1z" fill="#fff"/></svg>`
const SUMMARY =
  `<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path d="M8 1.2c.35 3.75 2.05 5.45 5.8 5.8-3.75.35-5.45 2.05-5.8 5.8C7.65 9.05 5.95 7.35 2.2 7 5.95 6.65 7.65 4.95 8 1.2zM13 10.4c.12 1.35.75 1.98 2.1 2.1-1.35.12-1.98.75-2.1 2.1-.12-1.35-.75-1.98-2.1-2.1 1.35-.12 1.98-.75 2.1-2.1z" fill="currentColor"/></svg>`
const GEAR =
  `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M6.4 1.8h3.2l.4 1.5 1.4-.5 1.6 1.6-.5 1.4 1.5.4v3.2l-1.5.4.5 1.4-1.6 1.6-1.4-.5-.4 1.5H6.4l-.4-1.5-1.4.5-1.6-1.6.5-1.4L1.8 9.6V6.4l1.5-.4-.5-1.4 1.6-1.6 1.4.5.4-1.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`
const OPEN =
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6.2 3.2H3.8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.8M8.2 2.8h5v5M13.1 2.9 7.4 8.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const NESTED =
  `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2.5 4h8M2.5 7h10.5M5.5 10h7.5M5.5 13h5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`
const MORE =
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.5" cy="8" r="1" fill="currentColor"/></svg>`

const stack = (networks: ReadonlyArray<"hn" | "reddit" | "x">, count: number): string => {
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

const navItem = (
  kind: "summary" | "hackernews" | "reddit" | "x" | "settings",
  on: boolean,
  badge?: number
): string => {
  const glyph =
    kind === "summary" ? SUMMARY
      : kind === "settings" ? GEAR
        : kind === "hackernews" ? HN_Y
          : kind === "reddit" ? REDDIT
            : X_MARK
  const networkAttr = kind === "summary" || kind === "settings" ? "" : ` data-network="${kind}"`
  const dockAttr = kind === "summary" ? ` data-dock="summary"` : ""
  const classes = [
    "parle-nav-item",
    on ? "parle-nav-on" : "",
    kind === "settings" ? "parle-nav-settings" : ""
  ].filter(Boolean).join(" ")
  const badgeHtml = badge === undefined
    ? (kind === "summary" ? `<span class="parle-nav-soon"></span>` : "")
    : `<span class="parle-nav-badge" aria-hidden="true">${badge}</span>`
  return (
    `<button class="${classes}" type="button"${networkAttr}${dockAttr}>` +
    `<span class="parle-nav-icon"><span class="parle-nav-mark">${glyph}</span>` +
    `${badgeHtml}</span></button>`
  )
}

const panel = (
  network: "hackernews" | "reddit" | "x",
  comments: ReadonlyArray<{
    who: string
    age: string
    text: string
    replies?: string
    nested?: { who: string; age: string; text: string; replies?: string }
  }>,
  nav: string
): string => {
  const title =
    network === "hackernews"
      ? "WorldClaw — Agentic 3D open-world generation at scale"
      : network === "reddit"
        ? "A closer look at the WorldClaw demo"
        : "WorldClaw is a fascinating use of generative 3D"
  const said = comments.map((comment) => (
    `<article class="parle-comment">` +
    `<div class="parle-comment-who">${comment.who}<span class="parle-comment-age">${comment.age}</span></div>` +
    `<p class="parle-comment-text">${comment.text}</p>` +
    (comment.replies === undefined
      ? ""
      : `<button class="parle-comment-more" type="button">${comment.replies}</button>`) +
    (comment.nested === undefined
      ? ""
      : `<div class="parle-replies"><article class="parle-comment">` +
        `<div class="parle-comment-who">${comment.nested.who}<span class="parle-comment-age">${comment.nested.age}</span></div>` +
        `<p class="parle-comment-text">${comment.nested.text}</p>` +
        (comment.nested.replies === undefined
          ? ""
          : `<button class="parle-comment-more" type="button">${comment.nested.replies}</button>`) +
        `</article></div>`) +
    `</article>`
  )).join("")
  return `
<div class="parle parle-compact" style="height:100%;display:flex;flex-direction:column">
  <div class="parle-body" style="flex:1;min-height:0;overflow:auto">
    <div class="parle-main">
      <section class="parle-group parle-group-linked parle-room" data-network="${network}">
        <div class="parle-row-holder parle-home" data-network="${network}">
          <a class="parle-room-title" href="#">${title}</a>
          <div class="parle-comments">
            <div class="parle-comments-tools">
              <button class="parle-comments-mode" type="button">${NESTED}<span>Nested</span><span class="parle-comments-chevron">⌄</span></button>
              <button class="parle-comments-collapse" type="button">Collapse all</button>
              <span class="parle-comments-spacer"></span>
              <button class="parle-comments-open" type="button" aria-label="Open discussion">${OPEN}</button>
              <span class="parle-comments-menu-wrap"><button class="parle-comments-more-actions" type="button" aria-label="More actions">${MORE}</button></span>
            </div>
            ${said}
          </div>
        </div>
      </section>
    </div>
  </div>
  <div class="parle-nav-slot">${nav}</div>
</div>`
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
  .article { max-width: 560px; margin: 48px 56px; line-height: 1.55; }
  .article h1 { font-size: 34px; letter-spacing: -0.02em; margin: 0 0 12px; }
  .article p { font-size: 17px; color: #3a414c; }
  .label {
    font: 600 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0.08em; text-transform: uppercase; color: #5c574e;
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
    color: #5c574e;
  }
  .panel-frame {
    width: 360px; height: 560px; overflow: hidden;
    border-radius: 14px; box-shadow: 0 16px 48px rgba(10,12,16,0.16);
    background: #fff;
  }
  .panels { display: flex; gap: 18px; align-items: stretch; }
  ${PANEL_STYLES}
  .parle-pill::after { animation: none; opacity: 0; }
  .parle-pill { animation: none; }
</style>
${body}`

const nav = (on: "hackernews" | "reddit" | "x"): string => `
<nav class="parle-nav" aria-label="Discussions">
  <div class="parle-nav-strip" role="tablist">
    ${navItem("summary", false)}
    ${navItem("hackernews", on === "hackernews", 311)}
    ${navItem("reddit", on === "reddit", 112)}
    ${navItem("x", on === "x", 24)}
  </div>
  <div class="parle-nav-utilities">
    ${navItem("settings", false)}
  </div>
</nav>`

const frames: Array<{ name: string; width: number; height: number; body: string }> = [
  {
    name: "01-stacked-marks",
    width: 1100,
    height: 640,
    body: `
      <div class="article">
        <h1>What the internet already said</h1>
        <p>Parle’s mark stacks the Networks that are talking — drag it anywhere;
        it remembers. Blue count badge, no green.</p>
      </div>
      <div style="position:absolute;left:56px;bottom:56px;right:56px">
        <div class="card">
          <p class="label">On-page mark</p>
          <div class="marks">
            <div class="mark-slot">${stack(["hn"], 3)}<span class="cap">Hacker News</span></div>
            <div class="mark-slot">${stack(["hn", "reddit"], 12)}<span class="cap">HN + Reddit</span></div>
            <div class="mark-slot">${stack(["hn", "reddit", "x"], 28)}<span class="cap">Full stack</span></div>
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
        <p class="label">Comments first · icon dock · iOS badges · nested collapsed</p>
        <h1 style="font:700 28px/1.2 Georgia, serif;margin:0 0 18px;letter-spacing:-0.02em">
          Only what the page does not already tell you
        </h1>
        <div class="panels">
          <div class="panel-frame">
            ${panel(
              "hackernews",
              [
                { who: "ancient", age: "2d", text: "Every few years a new CT scan forces another rewrite of the gear train.", replies: "3 replies" },
                {
                  who: "compiler",
                  age: "2d",
                  text: "It is hard to overstate how modern the differential gearing looks.",
                  nested: {
                    who: "geartrain",
                    age: "2d",
                    text: "The surviving fragments make that even more remarkable.",
                    replies: "2 more replies"
                  }
                }
              ],
              nav("hackernews")
            )}
          </div>
          <div class="panel-frame">
            ${panel(
              "reddit",
              [
                { who: "u/labcoat", age: "3h", text: "Figure 3’s error bars are doing a lot of work here.", replies: "2 replies" },
                { who: "u/skeptic", age: "3h", text: "Replication or it didn’t happen — still, glad this is public." }
              ],
              nav("reddit")
            )}
          </div>
          <div class="panel-frame">
            ${panel(
              "x",
              [
                { who: "@physicshq", age: "1h", text: "Reading now. The apparatus diagram is clearer than the abstract." },
                { who: "@meterologist", age: "1h", text: "Not my field — but the tone in replies is unusually careful." }
              ],
              nav("x")
            )}
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
        <p>Parle opens straight into the comments — no repeated title, no Network
        name, no tall tabs. Counts float on the icons like iOS badges.</p>
      </div>
      <div class="panel-frame" style="position:absolute;right:0;top:0;bottom:0;height:auto;width:380px;border-radius:0;box-shadow:-12px 0 40px rgba(10,12,16,0.14)">
        ${panel(
          "hackernews",
          [
            { who: "ancient", age: "2d", text: "Every few years a new CT scan forces another rewrite of the gear train.", replies: "3 replies" },
            {
              who: "compiler",
              age: "2d",
              text: "It is hard to overstate how modern the differential gearing looks.",
              nested: {
                who: "geartrain",
                age: "2d",
                text: "The surviving fragments make that even more remarkable.",
                replies: "2 more replies"
              }
            }
          ],
          nav("hackernews")
        )}
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
