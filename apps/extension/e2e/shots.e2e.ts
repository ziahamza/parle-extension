/**
 * The design review: every surface, at both viewports, photographed.
 *
 * `parle.e2e.ts` asserts on behaviour and takes a few incidental pictures. This
 * file exists for the other question — *does it look like anything* — and that
 * question cannot be answered by a selector count. It drives the real extension
 * through the real states and writes a numbered set of images a human (or a
 * model with eyes) can open one after another.
 *
 * Two viewports, because ADR 0003 puts iOS in v1 and the surface is one
 * responsive thing rather than two builds: **1280x900** is the docked-right
 * case, **390x844** is the iPhone full-screen case. The same code draws both,
 * so a regression in one is usually a regression in the other, and the only way
 * to know is to look at both.
 *
 * The toolbar popup is shot at **360x600** and not at the tab size Chrome hands
 * a `chrome-extension://` page opened by hand. A popup is 360 wide in the
 * product; photographing it at 1280 photographs a layout no reader will ever
 * see, and the footer that wraps onto two lines at 360 does not wrap at 1280.
 * That bug was invisible for exactly that reason.
 *
 * It also counts the words on the two prose screens, because "cut it hard" is a
 * claim with a number in it and the number should come from the rendered page
 * rather than from a source file — `innerText` sees what the reader sees,
 * including that the long version behind a `<details>` is not on the screen
 * until it is asked for.
 *
 * Nothing here asserts. A failed expectation is a picture that looks wrong.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { spawn } from "node:child_process"
import { chromium, type Browser, type Page } from "playwright"
import {
  asidePanels,
  launch,
  pillPanel,
  SAFARI_EXTENSION_PATH,
  SHOTS_PATH,
  type Harness,
  type Surface,
  trustedClick
} from "./harness.ts"
import { startProvider } from "./provider.ts"

const DESKTOP = { width: 1280, height: 900 }
const PHONE = { width: 390, height: 844 }
const DEBUG_PORT = 9411

const ARTICLE = "https://www.nature.com/articles/d41586-024-02012-5"
const QUIET = "https://parle-e2e-nobody-has-discussed-this.com/piece"
const QUIET_TITLE = "Zmbrqx Ttlpwd Kvvn 91827"
const KEY = "sk-parle-shots-0000-DO-NOT-USE-1234567890"

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

const until = async (
  condition: () => boolean | Promise<boolean>,
  within = 25_000
): Promise<boolean> => {
  const deadline = Date.now() + within
  for (;;) {
    if (await condition()) return true
    if (Date.now() > deadline) return false
    await settle(250)
  }
}

const shots: Array<string> = []

const shoot = async (
  page: Page,
  name: string,
  options: { readonly full?: boolean; readonly clip?: { x: number; y: number; width: number; height: number } } = {}
): Promise<void> => {
  const file = path.join(SHOTS_PATH, `${name}.png`)
  await page.screenshot({
    path: file,
    fullPage: options.full ?? false,
    ...(options.clip === undefined ? {} : { clip: options.clip })
  }).catch((e) => console.log(`  (could not shoot ${name}: ${String(e).slice(0, 80)})`))
  shots.push(name)
  console.log(`  shot  ${name}.png`)
}

/** Words a reader actually sees, which is not the same as words in the file. */
const wordsOn = async (page: Page): Promise<number> => {
  const text = await page.innerText("body").catch(() => "")
  return text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length
}

/** Crop around wherever the reader (or the default) parked the mark. */
const markCrop = async (
  page: Page,
  pill: { boxOf: (selector: string) => Promise<{ x: number; y: number; width: number; height: number } | null> }
) => {
  const box = await pill.boxOf(".parle-pill")
  if (box === null) {
    const width = page.viewportSize()?.width ?? 1280
    return { x: width - 128, y: 0, width: 128, height: 128 }
  }
  const pad = 36
  return {
    x: Math.max(0, Math.floor(box.x - pad)),
    y: Math.max(0, Math.floor(box.y - pad)),
    width: Math.ceil(box.width + pad * 2),
    height: Math.ceil(box.height + pad * 2)
  }
}

/**
 * The whole display, browser chrome included.
 *
 * `page.screenshot()` photographs the page's own viewport and nothing else,
 * which is exactly wrong for the one claim this file exists to make visible:
 * the browser's side panel is not IN the page, it is chrome NEXT to it. A page
 * screenshot of an article with the panel open looks identical to a page
 * screenshot without it — the panel is simply not in the frame, and the picture
 * would quietly prove nothing.
 *
 * So this asks X for the root window instead. Under `xvfb-run` that is the
 * whole virtual screen: Chrome's tab strip, the article reflowed into what is
 * left of the window, and Parle sitting beside it. That is the picture.
 */
const shootDisplay = async (name: string): Promise<void> => {
  const file = path.join(SHOTS_PATH, `${name}.png`)
  await new Promise<void>((resolve) => {
    const proc = spawn("import", ["-window", "root", "-silent", file], { stdio: "ignore" })
    proc.on("close", () => resolve())
    proc.on("error", () => resolve())
  })
  if (fs.existsSync(file)) {
    shots.push(name)
    console.log(`  shot  ${name}.png  (whole display — browser chrome included)`)
  } else {
    console.log(`  (could not photograph the display for ${name})`)
  }
}

/**
 * Does this page scroll sideways?
 *
 * The cheapest true statement about a responsive layout, and the one a
 * screenshot hides: a 390px shot of a page that is 438px wide looks like a
 * page with its right edge cropped, which is easy to read as "the phone is
 * narrow" rather than as a bug. It caught one here — `width: 100%` on a
 * padded element with no `box-sizing`. On an article it is also the check
 * that the injected surface has not pushed the reader's own page about.
 */
const sideways = async (page: Page): Promise<string> => {
  const measured = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  })).catch(() => ({ scroll: 0, client: 0 }))
  return measured.scroll > measured.client + 1
    ? `OVERFLOWS by ${measured.scroll - measured.client}px`
    : "fits"
}

const readPage = async (page: Page, address: string) => {
  await page.bringToFront()
  await page.goto(address, { waitUntil: "domcontentloaded" }).catch(() => {})
}

/**
 * The one picture this whole exercise is for: Parle beside the article.
 *
 * Its own run, because it needs three things the rest of this file cannot have
 * at the same time, and each of them was a wrong picture first:
 *
 *   1. **`viewport: null`.** Playwright's default pins the page's viewport, and
 *      a pinned page does not reflow when the browser gives a third of the
 *      window to the panel — it renders at 1280 inside an 894px hole, which
 *      photographs as a broken layout that is entirely the harness's doing.
 *      Measured: clearing the override from a second CDP session does not help,
 *      the page stays pinned at 1280 even after the window is resized to 900.
 *      And `viewport: null` makes `page.setViewportSize()` throw, which the
 *      phone shots above all use — hence a separate run rather than a flag.
 *   2. **A trusted click.** The mark is clicked with the real mouse at its own
 *      coordinates, the same way a reader would.
 *   3. **A camera that sees the page.** The dock is in the document, so a page
 *      screenshot is enough; `shootDisplay` still captures the window around it.
 *
 * The article is served rather than fetched for the same reason `parle.e2e.ts`
 * serves it: nature.com opens a modal cookie `<dialog>`, and a modal dialog
 * makes the rest of the document inert, so a real click never reaches the mark.
 */
const asideShots = async () => {
  console.log("\n=== Parle on the article (the in-page panel) ===\n")
  const h = await launch({
    debugPort: DEBUG_PORT + 2,
    viewport: null,
    profilePath: path.resolve(SHOTS_PATH, "..", ".e2e-profile-aside")
  })
  try {
    const page = h.context.pages()[0] ?? (await h.context.newPage())
    const welcome = await h.context.newPage()
    await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`)
    await welcome.bringToFront()
    await welcome.locator("#on").click().catch(() => {})
    await settle(800)
    await welcome.close()

    await h.context.route(ARTICLE, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><meta charset="utf-8">` +
          `<title>Not all 'open source' AI models are actually open</title>` +
          `<style>body{font:17px/1.7 Georgia,serif;margin:0;padding:40px;color:#16181d}` +
          `h1{font:600 30px/1.25 system-ui,sans-serif;margin:0 0 20px;letter-spacing:-.02em}` +
          `p{margin:0 0 18px;max-width:34rem}` +
          `@media (prefers-color-scheme:dark){body{background:#16181d;color:#e7e9ee}}</style>` +
          `<h1>Not all 'open source' AI models are actually open</h1>` +
          `<p>The point of the picture beside this text is that this text is still ` +
          `readable next to the in-page discussion panel.</p>` +
          `<p>Researchers say that some models described as open source are nothing ` +
          `of the kind: the weights are published, the training data is not, and the ` +
          `licence forbids the uses that would make the distinction matter.</p>` +
          `<p>What the internet made of that claim is what Parle is showing on the ` +
          `right — the conversations that already happened about this exact page, ` +
          `with their own links pointing back here.</p>`
      }))

    await readPage(page, ARTICLE)
    const pill = await pillPanel(page)
    const marked = await until(async () => (await pill.count(".parle-pill")) > 0, 40_000)
    console.log(`  mark on the page: ${marked}`)
    await settle(1200)
    await shootDisplay("21-aside-before")

    await trustedClick(page, pill, ".parle-pill")
    await settle(2400)
    const docked = (await pill.count(".parle-dock")) === 1
    console.log(
      `  the in-page dock: ${docked ? "open" : "NOT OPEN"}` +
        ` — browser side panels: ${(await asidePanels(h)).length}`
    )
    await shootDisplay("22-aside-beside-the-article")
    await shoot(page, "23-aside-alone")
    await page.emulateMedia({ colorScheme: "dark" })
    await settle(900)
    await shoot(page, "24-aside-alone-dark")
    await page.emulateMedia({ colorScheme: "light" })
    console.log(`  the reader's own page, with the panel open: ${await sideways(page)}`)
  } finally {
    await h.close()
  }
}

/**
 * The same in-page dock, from the Safari-shaped build.
 *
 * Chrome and Safari now share one surface. This run still loads the Safari
 * artifact so a future split cannot quietly drop the constraining build
 * ADR 0003 ships. See `SAFARI_EXTENSION_PATH`.
 *
 * The numbering is unchanged, so 22 through 27 still mean what they meant.
 */
const overlayShots = async () => {
  console.log("\n=== The surface Safari and iOS get (the Safari-shaped build) ===\n")
  const h = await launch({
    extensionPath: SAFARI_EXTENSION_PATH,
    profilePath: path.resolve(SHOTS_PATH, "..", ".e2e-profile-safari")
  })
  try {
    const page = h.context.pages()[0] ?? (await h.context.newPage())
    const welcome = await h.context.newPage()
    await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`)
    await welcome.bringToFront()
    await welcome.locator("#on").click().catch(() => {})
    await settle(800)
    await welcome.close()

    await page.setViewportSize(DESKTOP)
    await readPage(page, ARTICLE)
    const pill = await pillPanel(page)
    const marked = await until(async () => (await pill.count(".parle-pill")) > 0, 40_000)
    console.log(`  mark on the page: ${marked}`)
    await settle(1500)

    console.log("\nThe surface, docked right:")
    await pill.click(".parle-pill")
    await settle(1400)
    await shoot(page, "22-overlay-dock-desktop")

    await page.emulateMedia({ colorScheme: "dark" })
    await settle(500)
    await shoot(page, "23-overlay-dock-desktop-dark")
    await page.emulateMedia({ colorScheme: "light" })

    console.log("\nThe surface, on a phone:")
    await page.setViewportSize(PHONE)
    await settle(900)
    await shoot(page, "24-overlay-dock-phone")
    console.log(`  the reader's own page, with the surface open at 390px: ${await sideways(page)}`)

    await pill.click(".parle-close")
    await settle(600)
    await shoot(page, "25-overlay-mark-phone")
    await shoot(page, "26-overlay-mark-phone-crop", { clip: await markCrop(page, pill) })

    await page.emulateMedia({ colorScheme: "dark" })
    await pill.click(".parle-pill")
    await settle(900)
    await shoot(page, "27-overlay-dock-phone-dark")
    await page.emulateMedia({ colorScheme: "light" })
  } finally {
    await h.close()
  }
}

const main = async () => {
  console.log("\n=== Parle — design shots ===\n")
  // Old frames are worse than none: a run that fails halfway leaves last run's
  // picture sitting under this run's name, and it will be believed.
  fs.rmSync(SHOTS_PATH, { recursive: true, force: true })
  fs.mkdirSync(SHOTS_PATH, { recursive: true })

  const h: Harness = await launch({ debugPort: DEBUG_PORT })
  console.log(`extension ${h.extensionId}\n`)

  /**
   * The toolbar popup as a popup, which is the only way to photograph it true.
   *
   * `chrome.action.openPopup()` opens the real thing against the real active
   * tab, so the background resolves `Watch(null)` to the article rather than to
   * a tab of ours — which is what makes the account of every Place appear at
   * all. Playwright's persistent context never adopts that target, but a second
   * CDP client sees it as an ordinary page. No test-only code in the product,
   * and the picture is the shipped popup at the size Chrome gives it.
   */
  const remotes: Array<Browser> = []
  const openRealPopup = async (): Promise<Page | null> => {
    const said = await h.worker.evaluate(async () => {
      try {
        await chrome.action.openPopup()
        return "ok"
      } catch (e) {
        return `refused: ${String(e)}`
      }
    }).catch((e) => `worker refused: ${String(e)}`)
    if (said !== "ok") console.log(`  openPopup ${said}`)
    // Connected AFTER the popup exists, and freshly each time: a client
    // attached beforehand does not always adopt a target that appears later.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const remote = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`)
      remotes.push(remote)
      const found = remote.contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().endsWith("popup.html"))
      if (found !== undefined) return found
      await remote.close().catch(() => {})
      remotes.pop()
      await settle(400)
    }
    return null
  }
  const page = h.context.pages()[0] ?? (await h.context.newPage())

  await h.context.route(QUIET, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body:
        `<!doctype html><meta charset="utf-8"><title>${QUIET_TITLE}</title>` +
        `<style>body{font:16px/1.6 -apple-system,system-ui,sans-serif;margin:0;padding:48px;max-width:38rem;color:#16181d}` +
        `h1{font-size:1.7rem;margin:0 0 .6rem}p{color:#55607a}` +
        `@media (prefers-color-scheme: dark){body{background:#16181d;color:#e7e9ee}p{color:#a8b0c0}}</style>` +
        `<h1>${QUIET_TITLE}</h1><p>Nobody has discussed this page. Parle asked anyway, everywhere ` +
        `answered, and this page should carry no mark and no node of ours at all.</p>`
    }))

  // ------------------------------------------------------------- first run
  console.log("First run:")
  const welcome = await h.context.newPage()
  await welcome.setViewportSize(DESKTOP)
  await welcome.goto(`chrome-extension://${h.extensionId}/welcome.html`)
  await settle(600)
  const firstRunWords = await wordsOn(welcome)
  await shoot(welcome, "10-first-run-desktop")

  await welcome.setViewportSize(PHONE)
  await settle(300)
  await shoot(welcome, "11-first-run-phone")
  const firstRunFit = await sideways(welcome)
  console.log(`  first run at 390px: ${firstRunFit}`)

  await welcome.emulateMedia({ colorScheme: "dark" })
  await welcome.setViewportSize(DESKTOP)
  await settle(300)
  await shoot(welcome, "12-first-run-dark")
  await welcome.emulateMedia({ colorScheme: "light" })

  await welcome.setViewportSize(DESKTOP)
  await welcome.bringToFront()
  await welcome.locator("#on").click()
  await settle(800)
  await shoot(welcome, "13-first-run-answered")
  await welcome.close()

  // ---------------------------------------------------------------- the mark
  console.log("\nThe mark, on a page that has discussions:")
  await page.setViewportSize(DESKTOP)
  await readPage(page, ARTICLE)
  const pill = await pillPanel(page)
  const marked = await until(async () => (await pill.count(".parle-pill")) > 0, 40_000)
  console.log(`  mark on the page: ${marked}`)
  await settle(2000)
  await shoot(page, "20-mark-desktop")
  await shoot(page, "21-mark-crop", { clip: await markCrop(page, pill) })

  // The panel beside the article is photographed by `asideShots` below, from a
  // run of its own: it needs `viewport: null` so the article really reflows,
  // and that is incompatible with the `setViewportSize` calls this run makes.
  // Opened here anyway, so the Digest shots further down are of the container
  // the reader would actually be reading it in.
  console.log("\nThe surface beside the article:")
  await trustedClick(page, pill, ".parle-pill")
  await settle(2000)
  console.log(`  the in-page dock: ${(await pill.count(".parle-dock")) === 1 ? "open" : "NOT OPEN"}`)

  // The mark over white, which is the case its own colour makes hardest: the
  // top of nature.com is a grey advertisement, and a white circle on grey
  // flatters a white circle.
  await page.evaluate(() => window.scrollTo(0, 1600))
  await settle(600)
  await shoot(page, "28-mark-over-white", { clip: await markCrop(page, pill) })
  await page.evaluate(() => window.scrollTo(0, 0))

  // ------------------------------------------------------------- the toolbar
  console.log("\nThe toolbar status surface, as a real popup:")
  await page.bringToFront()
  await settle(500)
  const popup = await openRealPopup()
  if (popup === null) {
    console.log("  (the popup would not open — no picture of the account surface)")
  } else {
    await settle(1500)
    await shoot(popup, "30-status-popup")
    await popup.emulateMedia({ colorScheme: "dark" })
    await settle(500)
    await shoot(popup, "31-status-popup-dark")
    await popup.emulateMedia({ colorScheme: "light" })
    const account = await popup.innerText("body").catch(() => "")
    console.log(`  the account surface says:\n${account.split("\n").map((l) => `    ${l}`).join("\n")}`)
  }

  // ------------------------------------------------------------- the settings
  console.log("\nThe settings page:")
  const options = await h.context.newPage()
  await options.setViewportSize(DESKTOP)
  await options.goto(`chrome-extension://${h.extensionId}/options.html`)
  await settle(1200)
  const settingsWords = await wordsOn(options)
  await shoot(options, "40-settings-top")
  await options.evaluate(() => window.scrollTo(0, 900))
  await settle(300)
  await shoot(options, "41-settings-middle")
  await options.evaluate(() => window.scrollBy(0, 900))
  await settle(300)
  await shoot(options, "42-settings-lower")
  await options.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await settle(300)
  await shoot(options, "43-settings-foot")

  // Everything, including the long version the page keeps one click away.
  await options.evaluate(() => {
    for (const d of Array.from(document.querySelectorAll("details"))) d.open = true
  })
  await settle(300)
  const settingsWordsOpen = await wordsOn(options)
  await options.evaluate(() => window.scrollTo(0, 0))
  await settle(200)
  await shoot(options, "44-settings-longer-open")

  await options.setViewportSize(PHONE)
  await options.evaluate(() => {
    for (const d of Array.from(document.querySelectorAll("details"))) d.open = false
  })
  await settle(400)
  await shoot(options, "45-settings-phone")
  console.log(`  settings at 390px: ${await sideways(options)}`)
  await options.emulateMedia({ colorScheme: "dark" })
  await options.setViewportSize(DESKTOP)
  await settle(400)
  await shoot(options, "46-settings-dark")
  await options.emulateMedia({ colorScheme: "light" })

  // ------------------------------------------------------------------ digest
  //
  // The one surface a screenshot run cannot fake: ADR 0006 requires every
  // Finding to carry a source the reader can follow, and "carries a source" is
  // a claim about an underlined thing with an `href` on it, not about a field
  // in a struct. So a Provider is really connected, the comments are really
  // fetched, and what is photographed is what the Provider wrote.
  console.log("\nA Digest, with its citations:")
  const provider = await startProvider()
  await options.bringToFront()
  await options.getByRole("radio", { name: "An API key of your own" }).check()
  await settle(700)
  await options.getByRole("textbox", { name: "API key" }).fill(KEY)
  await options.getByRole("button", { name: "Save this key" }).click()
  await options.getByRole("button", { name: "Forget this key" }).first()
    .waitFor({ timeout: 10_000 }).catch(() => {})
  await settle(500)
  const endpoint = options.getByRole("textbox", { name: "Address to send it to" })
  await endpoint.fill(provider.baseUrl)
  await endpoint.press("Enter")
  await settle(700)
  const model = options.getByRole("textbox", { name: "Model", exact: true }).first()
  await model.fill("an-e2e-model")
  await model.press("Enter")
  await settle(800)
  await shoot(options, "47-settings-key-saved")
  await options.close()

  // A fresh tab: the background will not re-offer the mark to a tab it has
  // already offered one to inside its patience window.
  const reader = await h.context.newPage()
  await reader.setViewportSize(DESKTOP)
  await readPage(reader, ARTICLE)
  const readerPill = await pillPanel(reader)
  await until(async () => (await readerPill.count(".parle-pill")) > 0, 40_000)
  await trustedClick(reader, readerPill, ".parle-pill")
  await settle(1600)
  const digestPage = reader
  const withDigest: Surface = readerPill
  const offered = await until(async () => (await withDigest.count(".parle-act-digest")) > 0)
  console.log(`  the offer is on the surface: ${offered}`)
  await settle(600)
  await shoot(digestPage, "60-digest-offer")

  await withDigest.click(".parle-act-digest")
  const written = await until(async () => (await withDigest.count(".parle-finding")) > 0, 60_000)
  console.log(`  the Provider wrote one: ${written}`)
  await settle(800)
  await shoot(digestPage, "61-digest-written")
  const cited = await withDigest.count(".parle-source")
  const href = await withDigest.attribute(".parle-source", "href")
  console.log(`  ${cited} citation(s), the first pointing at ${href ?? "nothing"}`)

  await digestPage.emulateMedia({ colorScheme: "dark" })
  await settle(600)
  await shoot(digestPage, "63-digest-dark")
  await digestPage.emulateMedia({ colorScheme: "light" })
  await reader.close()
  await provider.close()

  // ------------------------------------------------------------------ quiet
  console.log("\nA page nobody has discussed:")
  const quiet = await h.context.newPage()
  await quiet.setViewportSize(DESKTOP)
  await readPage(quiet, QUIET)
  await settle(8000)
  const quietRoots = await pillPanel(quiet)
  const roots = await quietRoots.roots()
  const marks = await quietRoots.count(".parle-pill")
  console.log(`  shadow roots on the page: ${roots}, marks: ${marks}`)
  await shoot(quiet, "50-nothing-found")

  // The toolbar on that same page: nothing found is not nothing to say, and
  // this is the surface that has to say it whether or not anything was drawn.
  const quietPopup = await openRealPopup()
  if (quietPopup !== null) {
    await settle(1200)
    await shoot(quietPopup, "51-status-nothing-found")
    const said = await quietPopup.innerText("body").catch(() => "")
    console.log(`  the toolbar says:\n${said.split("\n").map((l) => `    ${l}`).join("\n")}`)
  }
  await quiet.close()

  for (const remote of remotes) await remote.close().catch(() => {})
  await h.close()

  await asideShots()
  await overlayShots()

  console.log(`\n${shots.length} shots in apps/extension/.e2e-shots/`)
  console.log(`\nWORDS`)
  console.log(`  first-run screen, as drawn:            ${firstRunWords}`)
  console.log(`  settings page, as drawn:               ${settingsWords}`)
  console.log(`  settings page, long version expanded:  ${settingsWordsOpen}`)
  console.log(`\nINJECTION`)
  console.log(`  page with nothing found: ${roots} shadow root(s), ${marks} mark(s)\n`)
}

main().catch((e) => {
  console.error("\nSHOT RUN FAILED:", e)
  process.exit(1)
})
