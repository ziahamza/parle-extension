/**
 * The store's flat art: the extension's own icons, and the two promotional
 * tiles the Chrome Web Store asks for.
 *
 * Nothing here is decorative and nothing here is stock. Every colour is a token
 * lifted verbatim from `apps/extension/src/view/styles.ts`, and the glyph is the
 * same path `apps/extension/src/entrypoints/pill.content.ts` draws on the page —
 * so the thing on the tile is the thing in the corner of the reader's window,
 * not an illustration of it. If the product's palette moves, these become wrong
 * in a way a human can see, which is the point of not inventing a second one.
 *
 * ## Why a browser rasterises this and not ImageMagick
 *
 * ImageMagick's own SVG renderer (MSVG) is a fallback that silently drops
 * rounded corners and mis-hints small text, and whether `rsvg` is delegated to
 * is a property of how the host's ImageMagick was compiled — so the same command
 * produces different art on two machines. Chromium is already a hard dependency
 * of this repo's e2e work and rasterises exactly what ships. So the browser
 * draws, and ImageMagick is used only to *downscale*, which it does the same way
 * everywhere.
 *
 * Everything is drawn at twice its final size and reduced with Lanczos. Text at
 * 440x280 is small enough that supersampling is the difference between a
 * legible subline and a grey smear, and the store shows the small tile at its
 * native size with no retina variant to fall back on.
 *
 * ## The icons
 *
 * The mark on the page is a WHITE circle carrying an ink glyph, which is right
 * over an article and useless in a browser toolbar: it would be white-on-white
 * in a light theme and a white blob in a dark one. So the toolbar icon inverts
 * it, and takes a ground that survives both Chrome themes at 16px.
 *
 * That ground is `#ff6600`, and it is the ONE place this project spends a
 * colour on itself. The rule everywhere else is that Parle has no house colour
 * and a hue only ever means which network a thread came from. A toolbar icon
 * cannot follow that rule: the ink disappears against a dark Chrome theme and
 * the paper disappears against a light one, so something saturated has to
 * carry the shape. Given that, orange is the honest choice rather than an
 * arbitrary one. It is already the colour a reader of this product associates
 * with "there is a discussion here", and inventing a fourth hue to dodge the
 * association would be decoration pretending to be a distinction.
 *
 * ## What the tiles may say
 *
 * `.scratch/parle-mvp/research/ticket-03.md` §7 names three claims this project
 * may never make. The subline here is the disclosure, not a feature: a tile that
 * said "private" would be false, and a tile that stayed silent about the address
 * leaving the browser would be the omission ADR 0005 exists to prevent. So the
 * sending is on the tile, in the second sentence, at a size a person reads.
 *
 * Run: `pnpm tsx store/make-art.ts`
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { chromium, type Browser } from "playwright"

const here = path.dirname(fileURLToPath(import.meta.url))
const STORE = here
const ICONS = path.join(STORE, "icons")
/** WXT's `publicDir` is `<project root>/public` — NOT under `srcDir`. */
const EXTENSION_ICONS = path.resolve(here, "../apps/extension/public/icon")

/**
 * The palette, from `apps/extension/src/view/styles.ts` and `apps/site/src/site.css`.
 * Do not invent a second one.
 *
 * `BG` is the mark's own disc, which is white because the panel's surface is
 * white. `GROUND` is the paper the tile is printed on, and it is the site's
 * warm off-white. They differ by design: a cream disc floating on cream paper
 * has no edge at all.
 */
const INK = "#15130f"
const MID = "#5c574e"
const FAINT = "#726c62"
const ACCENT = "#ff6600"
const BG = "#ffffff"
const GROUND = "#faf8f4"
const RULE = "rgba(21, 19, 15, 0.2)"
const LINE = "rgba(21, 19, 15, 0.1)"
const LIFT = "0 1px 2px rgba(21, 19, 15, 0.06), 0 10px 32px rgba(21, 19, 15, 0.14)"

/** The glyph, from `apps/extension/src/entrypoints/pill.content.ts`. viewBox 0 0 16 16. */
const BUBBLE =
  "M8 1.6c-3.6 0-6.5 2.3-6.5 5.2 0 1.7 1 3.2 2.5 4.1L3.3 14l3.2-1.7c.5.1 1 .1 1.5.1 3.6 0 6.5-2.3 6.5-5.2S11.6 1.6 8 1.6z"

const run = (command: string, args: ReadonlyArray<string>): Promise<number> =>
  new Promise((resolve) => {
    const proc = spawn(command, [...args], { stdio: "inherit" })
    proc.on("close", (code) => resolve(code ?? 1))
    proc.on("error", () => resolve(1))
  })

const sizeOf = (file: string): Promise<string> =>
  new Promise((resolve) => {
    const proc = spawn("identify", ["-format", "%wx%h", file])
    let out = ""
    proc.stdout.on("data", (d: Buffer) => { out += d.toString() })
    proc.on("close", () => resolve(out.trim()))
    proc.on("error", () => resolve("?"))
  })

/**
 * Draw one page at twice `width`x`height` and reduce it to exactly that.
 *
 * `deviceScaleFactor` rather than a CSS transform, so the browser lays the type
 * out at the real size and only rasterises finer — a transform would re-hint the
 * text and move the line breaks, which is how a tile that looked right in the
 * preview ships with a widow.
 */
const draw = async (
  browser: Browser,
  body: string,
  file: string,
  width: number,
  height: number,
  options: { readonly transparent?: boolean } = {}
): Promise<void> => {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2
  })
  await page.setContent(
    `<!doctype html><meta charset="utf-8">` +
      `<style>html,body{margin:0;padding:0;width:${width}px;height:${height}px;` +
      `overflow:hidden;-webkit-font-smoothing:antialiased;` +
      `text-rendering:optimizeLegibility}</style>${body}`,
    { waitUntil: "load" }
  )
  await page.evaluate(() => document.fonts.ready)
  const big = `${file}.2x.png`
  await page.screenshot({ path: big, omitBackground: options.transparent ?? false })
  await page.close()
  await run("convert", [big, "-filter", "Lanczos", "-resize", `${width}x${height}`, "+repage", file])
  fs.rmSync(big, { force: true })
  console.log(`  ${path.relative(process.cwd(), file)}  ${await sizeOf(file)}`)
}

/** The toolbar icon: the glyph in white, on the accent, full bleed with one radius. */
const iconMarkup = (): string => {
  // The path's own bounding box is roughly x 1.3..14.5, y 1.6..14 — centre on
  // that rather than on the viewBox, or the bubble's tail drags it off-centre.
  const scale = 3
  const x = 32 - 7.9 * scale
  const y = 32 - 7.8 * scale
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${ACCENT}"/>` +
    `<g transform="translate(${x} ${y}) scale(${scale})">` +
    `<path d="${BUBBLE}" fill="${BG}"/></g></svg>`
  )
}

/**
 * The mark as a flat lockup: white circle, ink glyph, one hairline edge.
 *
 * `--parle-lift` is deliberately NOT reproduced here, and this is the one place
 * the tile departs from `styles.ts`. That elevation exists to separate a thing
 * floating above an article from the article; on a plain white field there is
 * nothing to separate it from, so all it draws is a grey pool the size of the
 * mark itself — larger and greyer the bigger the mark, since the blur is stated
 * in absolute pixels against a 32px circle. Both tiles were shot with it and it
 * reads as a printing smudge, not as depth.
 *
 * What replaces it is the mark's own inset hairline at `--parle-rule`, scaled
 * with the diameter so a 128px circle does not get a 1px edge. The shape, the
 * ground, the glyph and the proportions are the shipped ones; only the shadow,
 * which is a statement about a page that is not in the picture, is gone.
 */
const markMarkup = (diameter: number): string => {
  const k = diameter / 32
  const px = (n: number) => `${(n * k).toFixed(2)}px`
  return (
    `<span style="display:grid;place-items:center;width:${diameter}px;height:${diameter}px;` +
    `border-radius:999px;background:${BG};box-shadow:inset 0 0 0 ${px(1.25)} ${RULE}">` +
    `<svg width="${Math.round(diameter * 0.5)}" height="${Math.round(diameter * 0.5)}" ` +
    `viewBox="0 0 16 16" fill="${INK}"><path d="${BUBBLE}"/></svg></span>`
  )
}

/**
 * The tiles pull the real brand faces over the network, at build time.
 *
 * `apps/site` sets its display type in Archivo and every number and label in
 * IBM Plex Mono, and a promotional tile drawn in whatever Noto happens to be
 * installed on the machine that ran this script is a picture of a different
 * product. Chromium has network access here and `document.fonts.ready` is
 * already awaited before the screenshot, so the honest thing is to load them.
 *
 * The fallbacks are stated anyway. If this ever runs offline the tile renders
 * in Liberation rather than failing, which is wrong but legible: the wordmark
 * is one word, and a substituted grotesk is a defect a human can see.
 */
const FONT_LINK =
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2` +
  `?family=Archivo:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">`
const SANS = `"Archivo", "Liberation Sans", system-ui, sans-serif`
const MONO = `"IBM Plex Mono", "Liberation Mono", ui-monospace, monospace`

/**
 * Every rule lives in a `<style>` block and never in a `style=` attribute.
 *
 * Not a preference. A font stack contains quoted family names, and
 * `style="font-family:"Noto Sans", …"` ends the HTML attribute at the first
 * quote — the browser then silently drops the rest of the declaration and lays
 * the tile out with default type at default sizes. It renders, it looks like a
 * design decision, and the only evidence is that the picture is wrong.
 */
const TILE_CSS = `
  /* The frame is fixed and the padding is inside it. Without this the padding
     is added to a width that is already the whole tile, and the overflow is
     clipped silently — which is how the small tile lost its bottom line and the
     marquee pushed the mark off the right edge, both while looking deliberate. */
  *, *::before, *::after { box-sizing: border-box; }
  body { background: ${GROUND}; color: ${INK}; font-family: ${SANS}; }
  .name {
    font-weight: 700;
    letter-spacing: -0.042em;
    line-height: 0.98;
  }
  .said { color: ${INK}; }
  .cost {
    font-family: ${MONO};
    color: ${FAINT};
    letter-spacing: 0.01em;
  }
  .rule { border-top: 1px solid ${RULE}; }
`

/**
 * 440x280. The store shows this one small and often beside a dozen others, so
 * it carries the name at a size that survives a thumbnail and exactly two
 * sentences: what it does, and what that costs.
 */
const smallTile = (): string => `
${FONT_LINK}
<style>
  ${TILE_CSS}
  body {
    padding: 30px 32px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .name { font-size: 46px; margin: 20px 0 14px; }
  .said { font-size: 15.5px; line-height: 1.42; max-width: 21em; }
  .rule { margin-top: 18px; padding-top: 11px; }
  .cost { font-size: 12px; line-height: 1.35; }
</style>
<body>
  <div>
    ${markMarkup(32)}
    <div class="name">Parle</div>
    <div class="said">See what Hacker News and Reddit already said about the page you are reading.</div>
  </div>
  <div class="rule">
    <div class="cost">Which means it sends that page&rsquo;s address to them.</div>
  </div>
</body>`

/**
 * 1400x560. Room enough for the sentence the small tile has to abbreviate, and
 * for the exclusion list to be described as what it is — a list, therefore
 * incomplete — rather than as a guarantee.
 */
const marqueeTile = (): string => `
${FONT_LINK}
<style>
  ${TILE_CSS}
  /* The rule under the wordmark is as wide as the column, so the column has a
     stated width rather than whatever is left over — otherwise the hairline
     runs on past the longest line and the block stops reading as one thing. */
  body { padding: 0 100px; display: flex; align-items: center; justify-content: space-between; gap: 64px; }
  .words { flex: 0 1 860px; }
  .name { font-size: 112px; margin: 0 0 32px; }
  .rule { padding-top: 32px; }
  .said { font-size: 33px; line-height: 1.28; letter-spacing: -0.015em; }
  .cost { font-size: 17.5px; line-height: 1.5; margin-top: 24px; }
  .mark { flex: 0 0 auto; }
</style>
<body>
  <div class="words">
    <div class="name">Parle</div>
    <div class="rule">
      <div class="said">See what Hacker News and Reddit have already said about the page you are reading.</div>
      <div class="cost">Which means it sends that page&rsquo;s address to those services, on every page
        except a built-in exclusion list you can read, add to, and switch off.</div>
    </div>
  </div>
  <div class="mark">${markMarkup(128)}</div>
</body>`

const main = async () => {
  fs.mkdirSync(ICONS, { recursive: true })
  fs.mkdirSync(EXTENSION_ICONS, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  try {
    console.log("\nIcons")
    const master = path.join(ICONS, "icon-512.png")
    // 64pt of SVG at 8x device scale is 512 device pixels — no resample at all
    // for the master, so every reduction below starts from a clean raster.
    const page = await browser.newPage({
      viewport: { width: 64, height: 64 },
      deviceScaleFactor: 8
    })
    await page.setContent(
      `<!doctype html><meta charset="utf-8">` +
        `<style>html,body{margin:0;width:64px;height:64px}</style>${iconMarkup()}`,
      { waitUntil: "load" }
    )
    await page.screenshot({ path: master, omitBackground: true })
    console.log(`  ${path.relative(process.cwd(), master)}  ${await sizeOf(master)}`)

    for (const size of [128, 48, 32, 16]) {
      const file = path.join(ICONS, `${size}.png`)
      // Canvas is deliberately the resizer. The old ImageMagick subprocess
      // resolved a missing `convert` as exit code 1 and then copied the stale
      // files already on disk, so the 512px master turned blue while Chrome
      // kept shipping green icons. This path has no optional executable and
      // returns the pixels drawn from the SVG currently on the page.
      const encoded = await page.evaluate(async (edge) => {
        const source = document.querySelector("svg")
        if (source === null) throw new Error("icon SVG is missing")
        const markup = new XMLSerializer().serializeToString(source)
        const image = new Image()
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
        await image.decode()
        const canvas = document.createElement("canvas")
        canvas.width = edge
        canvas.height = edge
        const context = canvas.getContext("2d")
        if (context === null) throw new Error("2D canvas is unavailable")
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = "high"
        context.drawImage(image, 0, 0, edge, edge)
        return canvas.toDataURL("image/png").split(",")[1] ?? ""
      }, size)
      fs.writeFileSync(file, Buffer.from(encoded, "base64"))
      console.log(`  ${path.relative(process.cwd(), file)}  ${await sizeOf(file)}`)
      // WXT discovers `public/icon/<size>.png` and writes the manifest's `icons`
      // itself, so the shipped artifact gets these with no manifest edit and no
      // change under `src/`.
      fs.copyFileSync(file, path.join(EXTENSION_ICONS, `${size}.png`))
    }
    await page.close()
    console.log(`  copied into ${path.relative(process.cwd(), EXTENSION_ICONS)}/`)

    console.log("\nTiles")
    await draw(browser, smallTile(), path.join(STORE, "small-promo-tile-440x280.png"), 440, 280)
    await draw(browser, marqueeTile(), path.join(STORE, "marquee-promo-tile-1400x560.png"), 1400, 560)
  } finally {
    await browser.close()
  }
  console.log("")
}

main().catch((e) => {
  console.error("\nART RUN FAILED:", e)
  process.exit(1)
})
