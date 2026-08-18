/**
 * The five pictures the Chrome Web Store listing is made of, at exactly 1280x800.
 *
 * `shots.e2e.ts` photographs every surface at every viewport so a human can
 * review the design. This is the other job: five frames, chosen, composed, and
 * emitted at the one size the store will accept — and it is a *submission
 * blocker* rather than a nicety, because the console will not enable "Submit for
 * review" until the draft has at least one 1280x800 or 640x400 screenshot in it.
 *
 * Everything below is the real extension in a real Chrome, driven through the
 * real states, against real Hacker News. Nothing is drawn for the camera. The
 * three things that took work are the three that make that true at 1280x800:
 *
 *   1. **The frame is the screen.** Chrome picks its own window size under Xvfb
 *      and leaves a black margin round the capture — `shots.e2e.ts`'s aside
 *      pictures are 1280x900 images containing a ~1060px window. So this run
 *      asks for `--window-size=1280,800 --window-position=0,0` against a screen
 *      that is exactly 1280x800, and `import -window root` is then the picture,
 *      pixel for pixel, with no resample and no crop. See `capture`.
 *   2. **The browser has to be in the frame at all.** Four of these five show
 *      something that is browser chrome and not page: the side panel, the
 *      toolbar popup, the extension's own icon. `page.screenshot()` cannot see
 *      any of it. Same answer as `shots.e2e.ts` — ask X for the root window.
 *   3. **A real article, chosen for the camera but not staged.** The article is
 *      whatever `PARLE_STORE_ARTICLE` names, and it is fetched from the live
 *      web: the Discussions in the panel are the ones Hacker News really
 *      returns for it, with the scores and comment counts it really reports.
 *      See {@link ARTICLE} for what the default was chosen against.
 *
 * ## Nothing here is a stand-in
 *
 * Shot 05 used to be a Digest, which meant starting the local stand-in Provider
 * from `provider.ts` and pasting an API key into the settings page of the very
 * profile the frame was photographed from. The summarising it produced was not
 * good enough to put in front of a store reviewer as a feature, so the frame is
 * now the busiest thread open with a reply tree expanded.
 *
 * The machinery went with it, deliberately. Leaving a Provider start in this
 * path is how a Digest ends up back in slot 5 the next time someone "just
 * regenerates the five" — and it would also mean every frame after it is shot
 * from a profile with a connected Provider, which is not the state a new reader
 * is in. Summarising can come back here when there is something worth showing,
 * and it should bring its own setup with it.
 *
 * Run: `pnpm --filter @parle/extension e2e:store`
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { chromium, type Browser, type Page } from "playwright"
import {
  asidePanels,
  launch,
  pillPanel,
  trustedClick,
  type Harness,
  type Surface
} from "./harness.ts"
import { ratesOf } from "./traffic.ts"

const here = path.dirname(fileURLToPath(import.meta.url))

/** Where the submission package lives. Nothing under `store/` is built code. */
const OUT = path.resolve(here, "../../../store/screenshots")

/** The one size the Chrome Web Store takes without resampling it for us. */
const FRAME = { width: 1280, height: 800 }

const PROFILE = path.resolve(here, "../.e2e-profile-store")
const DEBUG_PORT = 9421

/**
 * A page with real Discussions, no cookie wall, and something to look at.
 *
 * Chosen against three things that each cost a frame when they were wrong:
 *
 *   - **Several submissions, not one.** Twenty Hacker News stories point at this
 *     address, so the panel's strong tier is a stack of cards and the "also
 *     submitted" line has something to say. A page with a single submission
 *     photographs as one card above a long list of weaker matches, and the
 *     picture then argues for the wrong half of the product.
 *   - **No modal.** A cookie `<dialog>` makes the whole document inert, so a
 *     real click never reaches the mark — and it covers two thirds of the frame
 *     on the way.
 *   - **A page that looks like a page.** The first article tried here was a
 *     wall of unstyled prose at 893px: honest, legible, and a picture of
 *     nothing. Wikipedia has a headline, a figure and a measured column, which
 *     is what makes the hero's actual claim — *the article is still readable* —
 *     visible rather than asserted.
 *
 * Overridable so the composition can be re-judged without editing this file.
 */
const requestedArticle = process.env.PARLE_STORE_ARTICLE?.trim()
const ARTICLE = requestedArticle
  || "https://en.wikipedia.org/wiki/Antikythera_mechanism"

const articleUrl = new URL(ARTICLE)
if (articleUrl.protocol !== "http:" && articleUrl.protocol !== "https:") {
  throw new Error(
    `PARLE_STORE_ARTICLE must be an HTTP(S) URL, received ${ARTICLE}`
  )
}


const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

const until = async (
  condition: () => boolean | Promise<boolean>,
  within = 30_000
): Promise<boolean> => {
  const deadline = Date.now() + within
  for (;;) {
    if (await condition()) return true
    if (Date.now() > deadline) return false
    await settle(250)
  }
}

const run = (command: string, args: ReadonlyArray<string>): Promise<void> =>
  new Promise((resolve) => {
    const proc = spawn(command, [...args], { stdio: "ignore" })
    proc.on("close", () => resolve())
    proc.on("error", () => resolve())
  })

/** Read a PNG's IHDR directly, without requiring ImageMagick just to audit it. */
const sizeOf = async (file: string): Promise<string> => {
  try {
    const bytes = await fs.promises.readFile(file)
    if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return "?"
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
  } catch {
    return "?"
  }
}

/** The on-screen Chrome-for-Testing window, as macOS's compositor knows it. */
const macWindowId = (): Promise<string> =>
  new Promise((resolve) => {
    const script = [
      "import CoreGraphics",
      "let ws = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)! as! [[String: Any]]",
      "for w in ws {",
      "  let owner = w[kCGWindowOwnerName as String] as? String ?? \"\"",
      "  if owner.contains(\"Chrome for Testing\") { print(w[kCGWindowNumber as String]!); break }",
      "}"
    ].join("\n")
    const proc = spawn("swift", ["-e", script])
    let out = ""
    proc.stdout.on("data", (d: Buffer) => { out += d.toString() })
    proc.on("close", () => resolve(out.trim()))
    proc.on("error", () => resolve(""))
  })

const taken: Array<string> = []
const wrong: Array<string> = []

/**
 * Park the pointer somewhere with nothing under it.
 *
 * Every click in this run leaves the mouse where it landed, and a mouse resting
 * over a link makes Chrome draw its destination in a bubble at the bottom-left
 * of the window. It is browser chrome, so it is in the root-window capture, and
 * it put `.../File:Antikythera_Fragment_A_(Front).webp` across the bottom of the
 * hero. The left gutter outside the content column has no link in it on any of
 * the pages here; the wait is for the bubble's own fade.
 */
const restPointer = async (page: Page): Promise<void> => {
  await page.mouse.move(6, FRAME.height - 120).catch(() => {})
  await settle(900)
}

/**
 * Leave one tab in the strip: the one being photographed.
 *
 * The browser's own blank tab is not reliably in `context.pages()` at the moment
 * the extension's welcome tab appears — Playwright adopts targets on its own
 * schedule — so closing it once, early, closes nothing and the strip
 * photographs as `about:blank | Antikythera mechanism`. That is a picture of a
 * test harness. Called again before each capture instead, which is cheap and
 * does not depend on when anything was adopted.
 */
const tidyTabs = async (h: Harness, keep: Page): Promise<void> => {
  for (const other of h.context.pages()) {
    if (other === keep) continue
    const address = other.url()
    if (address === "about:blank" || address.startsWith("chrome://new-tab")) {
      await other.close().catch(() => {})
    }
  }
}

/**
 * The whole display, and then a check that the whole display was the right size.
 *
 * The check is not paranoia. Chrome silently clamps `--window-size` to the
 * screen and, on a screen it considers too small, keeps its own minimum — so a
 * run against the wrong `-screen` argument produces images that are plausible,
 * off by tens of pixels, and rejected by the console after the human has already
 * filled in the listing. A crop is applied so the file is at least always the
 * declared size, and the discrepancy is reported loudly rather than fixed
 * quietly.
 */
const capture = async (name: string, note: string): Promise<void> => {
  const file = path.join(OUT, `${name}.png`)
  if (process.platform === "darwin") {
    // Chrome's command-line window bounds are only advisory on macOS. Put the
    // real browser window at the store frame's CSS size, then capture that
    // window specifically so we never photograph the user's own Chrome.
    await run("osascript", [
      "-e", "tell application \"System Events\" to tell process \"Google Chrome for Testing\" to set position of front window to {0, 33}",
      "-e", `tell application \"System Events\" to tell process \"Google Chrome for Testing\" to set size of front window to {${FRAME.width}, ${FRAME.height}}`
    ])
    await settle(250)
    const windowId = await macWindowId()
    if (windowId !== "") await run("screencapture", ["-x", "-o", "-l", windowId, file])
    // Retina capture is exactly 2x the CSS-sized window. Converting it to 1x
    // preserves the intended frame without stretching or cropping content.
    if (await sizeOf(file) === `${FRAME.width * 2}x${FRAME.height * 2}`) {
      await run("sips", ["-z", String(FRAME.height), String(FRAME.width), file])
    }
  } else {
    await run("import", ["-window", "root", "-silent", file])
  }
  if (!fs.existsSync(file)) {
    console.log(`  MISSING  ${name}.png — the display would not photograph`)
    wrong.push(`${name}: not captured`)
    return
  }
  const measured = await sizeOf(file)
  if (measured !== `${FRAME.width}x${FRAME.height}`) {
    wrong.push(`${name}: display was ${measured}, cropped to ${FRAME.width}x${FRAME.height}`)
    await run("convert", [
      file,
      "-crop", `${FRAME.width}x${FRAME.height}+0+0`,
      "-background", "white",
      "-extent", `${FRAME.width}x${FRAME.height}`,
      "+repage",
      file
    ])
  }
  taken.push(name)
  console.log(`  ${name}.png  ${await sizeOf(file)}  — ${note}`)
}

// ---------------------------------------------------------------- the Digest

/** One comment, as `Prompt.render` wrote it into the Brief. */
interface BriefComment {
  readonly network: string
  readonly nativeId: string
  readonly id: string
  readonly text: string
}

/**
 * Every comment in the Brief, read back out of the text the extension sent.
 *
 * `packages/digest/src/Prompt.ts` writes `  network:`, `  nativeId:`,
 * `  COMMENT id:` and `    text:` one per line, with continuation lines indented
 * six spaces. Parsing it back is what makes the writer below a reader of the
 * material rather than a fixture: it cannot name a comment that was not put in
 * front of it, because it has no other source of ids.
 */
const commentsIn = (brief: string): ReadonlyArray<BriefComment> => {
  const found: Array<BriefComment> = []
  let network = ""
  let nativeId = ""
  let id: string | null = null
  let text: Array<string> = []
  const flush = () => {
    if (id !== null && text.length > 0) {
      found.push({ network, nativeId, id, text: text.join(" ").replace(/\s+/g, " ").trim() })
    }
    id = null
    text = []
  }
  let inText = false
  for (const line of brief.split("\n")) {
    const isNetwork = /^\s{2}network:\s*(\S+)\s*$/.exec(line)
    const isNative = /^\s{2}nativeId:\s*(\S+)\s*$/.exec(line)
    const isComment = /^\s{2}COMMENT id:\s*(\S+)\s*$/.exec(line)
    const isText = /^\s{4}text:\s?(.*)$/.exec(line)
    if (isNetwork !== null) { flush(); network = isNetwork[1] ?? ""; inText = false; continue }
    if (isNative !== null) { nativeId = isNative[1] ?? ""; inText = false; continue }
    if (isComment !== null) { flush(); id = isComment[1] ?? null; inText = false; continue }
    if (isText !== null) { text = [isText[1] ?? ""]; inText = true; continue }
    if (inText && /^\s{6}/.test(line)) { text.push(line.trim()); continue }
    inText = false
  }
  flush()
  return found
}

/** A quotable run of a comment: whole sentences, long enough to say something. */
const quotable = (text: string): string | null => {
  const cleaned = text.replace(/^[>\-\s]+/, "").trim()
  if (cleaned.length < 90) return null
  // A pasted link is a fine thing to say in a thread and a terrible thing to
  // photograph: it wraps across four lines of a 360px panel, it dominates the
  // Finding it is inside, and a store reviewer reads it as an advertisement.
  if (/https?:\/\//i.test(cleaned)) return null
  // Reply fragments ("Ah yes, …", "^ this") report the thread's manners rather
  // than its substance. A quote that opens mid-conversation is not a Finding.
  if (/^(ah|oh|yes|no|yeah|nope|exactly|this|agreed|same)\b/i.test(cleaned)) return null
  const sentences = cleaned.split(/(?<=[.!?])\s+/)
  let quote = ""
  for (const sentence of sentences) {
    if (quote.length > 0 && (`${quote} ${sentence}`).length > 190) break
    quote = quote.length === 0 ? sentence : `${quote} ${sentence}`
    if (quote.length > 110) break
  }
  quote = quote.trim()
  if (quote.length < 60 || quote.length > 210) return null
  if (!/[.!?]$/.test(quote)) return null
  return quote
}


// ------------------------------------------------------------------- the run

/**
 * Wikipedia's Appearance sidebar, put away before anything is photographed.
 *
 * Vector 2022 pins it open at this width, so it sat in shots 03 and 04 as a
 * column of Text/Width/Color radio buttons — and in 04 the toolbar popup
 * overlapped it, leaving orphaned fragments of Wikipedia's own header ("ount
 * Log in", "ide") around the edges. A reader who has ever collapsed it does not
 * see any of that; the screenshots should not either.
 *
 * This hides someone else's chrome, never ours: no Parle element is touched, so
 * nothing about the product is staged. Failure is ignored on purpose — this is
 * cosmetic, and an article that has no such panel is not a broken run.
 */
const putWikipediaChromeAway = async (target: Page): Promise<void> => {
  await target.addStyleTag({
    content: `
      #vector-appearance, .vector-appearance-landmark,
      #vector-appearance-pinned-container, .vector-settings { display: none !important; }
      /*
       * Donate / Create account / Log in. The mark parks in that same corner,
       * so in shot 03 it landed on top of them, and in shot 04 the toolbar
       * popup cut them in half and left "ount Log in" floating beside it. Both
       * read as a rendering fault rather than as a busy page.
       */
      #p-personal, .vector-user-links, .vector-user-links-main { display: none !important; }
    `
  }).catch(() => {})
}

const main = async () => {
  console.log("\n=== Parle — Chrome Web Store screenshots ===\n")
  console.log(`article: ${ARTICLE}`)
  console.log(`frame:   ${FRAME.width}x${FRAME.height}\n`)

  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  // The first-run screen only exists for a reader who has not answered yet, and
  // the answer lives in the profile. A stale profile photographs shot 05 as a
  // question already settled — which is exactly the frame a reviewer is meant to
  // meet first.
  fs.rmSync(PROFILE, { recursive: true, force: true })

  const h: Harness = await launch({
    debugPort: DEBUG_PORT,
    profilePath: PROFILE,
    // The article must genuinely reflow when the panel takes width from the
    // window; a pinned viewport renders 1280px of page inside an 894px hole.
    viewport: null,
    args: [
      `--window-size=${FRAME.width},${FRAME.height}`,
      "--window-position=0,0",
      "--hide-crash-restore-bubble"
    ]
  })
  console.log(`extension ${h.extensionId}\n`)

  // ADR 0014's audit, same as the behaviour run's: this run meets live Hacker
  // News, so its closing report states its own measured share of the IP's
  // Algolia budget rather than assuming a photographic run is small.
  const algoliaStamps: Array<number> = []
  h.context.on("request", (r) => {
    if (r.url().includes("hn.algolia.com")) algoliaStamps.push(Date.now())
  })

  const remotes: Array<Browser> = []
  /**
   * The toolbar popup as a popup, from a second CDP client.
   *
   * `chrome.action.openPopup()` opens the real thing against the real active
   * tab, which is what makes the account of every Place appear at all — opened
   * as a tab of ours it would report on itself. Playwright's persistent context
   * never adopts that target; a client connected *after* it exists does.
   */
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
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const remote = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`)
      remotes.push(remote)
      const found = remote.contexts().flatMap((c) => c.pages())
        .find((p) => p.url().endsWith("popup.html"))
      if (found !== undefined) return found
      await remote.close().catch(() => {})
      remotes.pop()
      await settle(400)
    }
    return null
  }

  /**
   * The extension's own first-run tab, and nothing beside it.
   *
   * The extension opens `welcome.html` itself on install, in a tab of its own,
   * and Chrome brings that tab to the front. Every earlier version of this run
   * navigated the *initial blank tab* to the same page and then drove that one —
   * so the article was loaded into a tab that was never in front, and two things
   * followed at once. The picture was of the wrong tab. And, less obviously, the
   * article got no Discussions at all: Parle only looks up the tab the reader is
   * actually looking at, so an article opened in the background is working
   * exactly as designed and photographs as a product that does nothing.
   *
   * Using the tab the extension opened is also simply more honest — it is the
   * one the reader meets — and closing the blank leaves a tab strip with one tab
   * in it rather than one that documents the harness.
   */
  const welcome = await (async (): Promise<Page> => {
    const its = () => h.context.pages().find((p) => p.url().endsWith("welcome.html"))
    await until(() => its() !== undefined, 20_000)
    const found = its()
    if (found === undefined) {
      const made = await h.context.newPage()
      await made.goto(`chrome-extension://${h.extensionId}/welcome.html`)
      return made
    }
    for (const other of h.context.pages()) {
      if (other !== found) await other.close().catch(() => {})
    }
    return found
  })()

  const page = welcome

  try {
    // ------------------------------------------------ 02 · the first question
    //
    // TAKEN first, because it is the only frame that needs the question
    // unanswered and answering it is the next thing this run does. NUMBERED
    // second, because the store shows screenshots in filename order and the two
    // that matter are the first two: the hero says what this is, and this one
    // says what it costs. Chrome's Limited Use policy wants that disclosure
    // prominent on the store page as well as in the product's own interface,
    // and second in the carousel is as prominent as a screenshot gets.
    console.log("The first question, before it is answered:")
    await page.bringToFront()
    await settle(2500)
    await tidyTabs(h, page)
    await settle(700)
    await capture(
      "02-what-parle-sends-before-anything-is-looked-up",
      "the first-run screen: the disclosure, and the two answers"
    )

    console.log("\nAnswering it:")
    await page.locator("#on").click()
    await settle(1200)

    // ------------------------------------------------------- 03 · the mark
    //
    // Retried, because everything in these five frames hangs off the mark being
    // on the page and the mark hangs off a live third party. Hacker News
    // answering slowly, or refusing once, is a Refusal — a fact about the
    // attempt and not about the Subject — and the honest response to one is to
    // ask again rather than to photograph a page with nothing on it and call it
    // the product.
    console.log("\nThe mark, on a page that has discussions:")
    let pill = await pillPanel(page)
    let marked = false
    for (let attempt = 1; attempt <= 3 && !marked; attempt += 1) {
      await page.goto(ARTICLE, { waitUntil: "domcontentloaded" }).catch(() => {})
    await putWikipediaChromeAway(page)
      await page.bringToFront()
      pill = await pillPanel(page)
      marked = await until(async () => (await pill.count(".parle-pill")) > 0, 60_000)
      console.log(`  attempt ${attempt}: the mark arrived: ${marked}`)
    }
    if (!marked) wrong.push("03: the mark never arrived — every frame below is of an empty page")
    console.log(`  it carries the count "${await pill.textOf(".parle-pill-count")}"`)
    // The mark's own arrival animation runs 420ms and its ring 1100ms, both
    // once. Photographed inside that window it is mid-flight and half
    // transparent, which reads as a rendering bug.
    await settle(2500)
    await tidyTabs(h, page)
    await restPointer(page)
    console.log(`  marks on the page at the shutter: ${await pill.count(".parle-pill")}`)
    await capture(
      "03-the-mark-and-its-count",
      "the whole of what Parle draws on a page it has something to say about"
    )

    // ---------------------------------------- 04 · where Parle asked, and what
    //                                               each one answered
    //
    // Before the panel is opened, so the popup is photographed over the article
    // rather than over our own surface.
    console.log("\nThe toolbar surface — every Place, and what each said:")
    await page.bringToFront()
    await settle(400)
    const popup = await openRealPopup()
    if (popup === null) {
      console.log("  (the popup would not open — NO PICTURE of the account surface)")
      wrong.push("04: the toolbar popup would not open")
    } else {
      // Wait for every Place to have said something. The account surface is
      // honest while a Lookup is in flight — "Still looking", and a row that
      // has not answered yet — and that honesty photographs as a product with
      // nothing to show. The picture this frame exists for is the settled one:
      // found here, refused there, deliberately not asked over there.
      //
      // Asked of `.parle-spinner`, which is the element the panel draws for
      // exactly this state, and not of the copy. Matching on the word "Looking"
      // is what the first version did, and the popup's own footer says "Looking
      // pages up automatically" — so the check reported an unsettled surface on
      // every run, including the ones that were fine.
      const settled = await until(
        async () => (await popup.locator(".parle-spinner").count().catch(() => 1)) === 0,
        40_000
      )
      if (!settled) wrong.push("04: the Places were still answering when the shutter went")
      await settle(1500)
      const account = await popup.innerText("body").catch(() => "")
      console.log(account.split("\n").map((l) => `    ${l}`).join("\n"))
      await capture(
        "04-where-parle-asked-and-what-each-answered",
        "the toolbar surface: found, refused, and not asked at all"
      )
      // Closed through its own document, not with a keypress at the page: a
      // popup is a separate widget and `page.keyboard` types into the tab
      // underneath it. It stayed open through the next two captures and sat on
      // top of the side panel in the hero.
      await popup.close().catch(async () => {
        await popup.evaluate(() => window.close()).catch(() => {})
      })
      await settle(1000)
    }

    // ------------------------------------------------------------ 01 · the hero
    console.log("\nThe in-page panel, on the article:")
    await page.bringToFront()
    await trustedClick(page, pill, ".parle-pill")
    await settle(3000)
    const docked = (await pill.count(".parle-dock")) === 1
    console.log(`  the in-page dock is ${docked ? "open" : "NOT OPEN"}`)
    if (!docked) wrong.push("01: the in-page panel did not open")
    if ((await asidePanels(h)).length !== 0) {
      wrong.push("01: a browser side panel opened — it must not")
    }
    await tidyTabs(h, page)
    await restPointer(page)
    await settle(600)
    await capture(
      "01-the-discussions-beside-the-article",
      "the hero: the reader keeps the article, and gets its discussions"
    )

    // ------------------------------------------ 05 · the busiest thread
    // A fresh tab: the background will not re-offer the mark to a tab it has
    // already offered one to inside its patience window.
    const reader = await h.context.newPage()
    await reader.goto(ARTICLE, { waitUntil: "domcontentloaded" }).catch(() => {})
    await putWikipediaChromeAway(reader)
    await reader.bringToFront()
    // The tab this run started in has done its work; leaving it open puts a
    // second tab in the strip whose only content is that this is a test run.
    await page.close().catch(() => {})
    await settle(600)
    const readerPill = await pillPanel(reader)
    await until(async () => (await readerPill.count(".parle-pill")) > 0, 45_000)
    await trustedClick(reader, readerPill, ".parle-pill")
    await settle(2500)

    const surface: Surface = readerPill

    /**
     * The most-discussed thread, opened and being read.
     *
     * This slot used to photograph a Digest. It no longer does: the only
     * Provider available to a screenshot run is the local stand-in in
     * `e2e/provider.ts`, and what it writes is not good enough to put in front
     * of a store reviewer as a product feature. Summarising can come back to
     * this carousel when there is something worth showing. Until then the fifth
     * frame does what the extension is actually for — the reader has the
     * busiest thread open and is reading its comments.
     */
    const opened = await until(async () => (await surface.count(".parle-room")) > 0, 45_000)
    if (!opened) wrong.push("05: no Discussion room was ever drawn")

    /*
     * A room existing is not the shot. The frame is meant to show a named
     * thread being read, so the title and the comments are what get asserted —
     * an untitled room with nothing under it would satisfy `.parle-room > 0`
     * and photograph as an empty panel.
     */
    const title = (await surface.textOf("a.parle-room-title")).trim()
    const comments = await surface.count(".parle-comment")
    console.log(`  the open thread: ${title || "(untitled)"} — ${comments} comment(s) drawn`)
    if (title === "") wrong.push("05: the open Discussion has no title to read")
    if (comments === 0) wrong.push("05: a thread with no comments drawn")

    /**
     * Opened one level down, so this frame is not a second copy of shot 01.
     *
     * Shot 01 is the panel arriving beside the article. This one is the reader
     * already in it — a reply tree expanded, which is the thing a flat list of
     * comments cannot show and the reason the panel exists rather than a link.
     */
    const expanded = await surface.click(".parle-comment-more")
    await settle(1200)
    const nested = await surface.count(".parle-replies")
    console.log(`  opened a reply tree: ${expanded} — ${nested} nested block(s)`)
    if (!expanded || nested === 0) {
      // `.parle-comment-more` is also the depth-cap control that sends the
      // reader out to the discussion, and that one never creates `.parle-replies`.
      wrong.push(
        "05: no reply tree opened — either the control clicked was the depth-cap " +
          "'Continue on the discussion' link, or this frame is shot 01 again"
      )
    }
    await settle(800)
    const roomBox = await surface.boxOf(".parle-room")
    const bodyBox = await surface.boxOf(".parle-body")
    if (roomBox === null) {
      wrong.push("05: the thread was drawn but never painted a box")
    } else if (bodyBox !== null && roomBox.y >= bodyBox.y + bodyBox.height) {
      wrong.push("05: the thread painted below the panel's visible body — it would be cropped")
    }
    await restPointer(reader)
    await capture(
      "05-the-most-discussed-thread-open",
      "the busiest thread, open and being read"
    )
    await reader.close()
  } finally {
    for (const remote of remotes) await remote.close().catch(() => {})
    await h.close()
  }

  const audit = ratesOf(algoliaStamps)
  console.log(
    `\nalgolia traffic (this run's own, measured): ${audit.total} request(s), ` +
      `peak ${audit.peakPerSecond}/s, sustained ${audit.sustainedPerSecond}/s`
  )
  console.log(`\n${taken.length} screenshot(s) in store/screenshots/`)
  for (const name of [...taken].sort()) console.log(`  ${name}.png`)
  if (wrong.length > 0) {
    console.log(`\nLOOK AT THESE BEFORE UPLOADING:`)
    for (const problem of wrong) console.log(`  - ${problem}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error("\nSTORE SHOT RUN FAILED:", e)
  process.exit(1)
})
