/**
 * The two screens that are entirely prose, read back the way a reader reads them.
 *
 * `render.test.ts` greps the panel. Nothing grepped these, and they are the two
 * surfaces where the words ARE the feature: the settings page carries the
 * standing disclosure that Chrome's Limited Use policy requires in the product's
 * user interface, and the first-run page carries the same claim at the one
 * moment showing it is a disclosure rather than an apology.
 *
 * The first-run page is static HTML, so it is read off disk rather than
 * rendered. That is the point — a claim in a `.html` file is exactly as visible
 * to the reader as one built by `document.createElement`, and exactly as
 * invisible to a test that only walks the DOM builders.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { Network } from "@parle/domain/Network"
import { seed } from "@parle/policy/Seed"
import { firstRun, withByok, withProviderConnection } from "../settings/Settings.ts"
import { type Fake, mountDouble } from "./domDouble.ts"
import { FOOTER, FORGETTING } from "./settingsCopy.ts"
import { renderSettings, type SettingsActs } from "./settingsView.ts"
import { FIRST_RUN } from "./welcomeCopy.ts"

const NOTHING: SettingsActs = {
  setNetwork: () => {},
  setAutomatic: () => {},
  setEveryDiscussion: () => {},
  addExclusion: () => {},
  removeExclusion: () => {},
  allowAnyway: () => {},
  removeAllowAnyway: () => {},
  resumeSite: () => {},
  forget: () => {},
  setProvider: () => {},
  setByok: () => {},
  setCodex: () => {},
  forgetProviderKey: () => {}
}

const COMPILED_OUT: ReadonlyArray<Network> = ["x"]

const drawn = (onDevice = false): Fake => {
  const root = mountDouble()
  renderSettings(
    root as unknown as HTMLElement,
    { settings: firstRun, artifact: seed, compiledOut: COMPILED_OUT, onDevice, notice: null },
    NOTHING
  )
  return root
}

/**
 * The first-run screen as a reader reads it, assembled from the copy module.
 *
 * It used to be read off disk as HTML, because that is where the prose lived.
 * It lives in `welcomeCopy.ts` now — one reviewable place for the disclosure,
 * alongside the settings page's — so the check follows it there. The two
 * sentences naming sites are derived from the build, so they are rendered here
 * with this build's answer, exactly as `welcome/main.ts` renders them.
 */
const firstRunProse = [
  FIRST_RUN.title,
  FIRST_RUN.sends(["Hacker News", "Reddit"]),
  FIRST_RUN.skips,
  FIRST_RUN.absent(["X"]) ?? "",
  FIRST_RUN.ask,
  FIRST_RUN.on,
  FIRST_RUN.off,
  FIRST_RUN.said.undecided,
  FIRST_RUN.more
].join(" ")

/** The shell the copy is drawn into, checked for the ids `main.ts` needs. */
const welcomeShell = readFileSync(
  fileURLToPath(new URL("../entrypoints/welcome/index.html", import.meta.url)),
  "utf8"
)

/**
 * The same list `render.test.ts` enforces on the panel, for the same reason.
 *
 * `CONTEXT.md` is binding and names five reader-facing terms. A disclosure that
 * explains itself in the project's own vocabulary has not disclosed anything.
 */
const NEVER = [
  "subject",
  "alias",
  "enquiry",
  "mention",
  "observation",
  "movement",
  "coverage",
  "consultation",
  "silence",
  "refusal",
  "withholding",
  "withheld",
  "garble",
  "harvest",
  "citation",
  "watermark",
  "prefilter",
  "exclusion list",
  "local discussion cache",
  "discussion index"
]

/** Ordinary English in lower case, vocabulary in upper. See `render.test.ts`. */
const NEVER_CAPITALISED = ["Lookup", "Lookups", "Place", "Places", "Reading", "Network", "Networks"]

const checkProse = (prose: string): void => {
  for (const term of NEVER) {
    expect(prose, `"${term}" reached the reader`).not.toMatch(new RegExp(`\\b${term}\\b`, "i"))
  }
  for (const term of NEVER_CAPITALISED) {
    expect(prose, `"${term}" reached the reader`).not.toContain(term)
  }
}

describe("the settings page", () => {
  it("says something under every heading", () => {
    expect(drawn().textContent.trim().length).toBeGreaterThan(500)
  })

  it("uses no engineering vocabulary", () => {
    // The built-in list is hostnames the reader is entitled to read; they are
    // data rather than our prose, so they are not held to our word list.
    const domains = new Set(seed.entries.map((entry) => entry.domain))
    const prose = [...domains].reduce(
      (text, domain) => text.split(domain).join(" "),
      drawn().textContent
    )
    checkProse(prose)
  })

  it("carries the disclosure, not a summary of it", () => {
    const text = drawn().textContent
    // Shorter than it was, and every load-bearing distinction still in it:
    // where the address goes, that those services see it, that the skip list
    // is a list, and that the fragment is never sent.
    expect(text).toContain("Hacker News, Reddit and X")
    expect(text).toContain("It is not anonymous.")
    expect(text).toContain("so it will miss things")
    expect(text).toContain("after the #")
  })

  it("footer reports the folded artifact's version, not always the seed's", () => {
    // ADR 0022's one visible fact: after the published update folds in, the
    // footer says the update's version. The double renders with a folded
    // artifact exactly the way options/main.ts hands one over — this is the
    // lock that goes red if the page ever hardcodes the seed again.
    const root = mountDouble()
    renderSettings(
      root as unknown as HTMLElement,
      {
        settings: firstRun,
        artifact: { version: 1, entries: seed.entries },
        compiledOut: COMPILED_OUT,
        onDevice: false,
        notice: null
      },
      NOTHING
    )
    expect(root.textContent).toContain("Skip list, version 1.")
    expect(drawn().textContent).toContain("Skip list, version 0.")
  })

  it("says what still runs when automatic lookups are off", () => {
    // The automatic-off sentence is Limited Use copy like everything else
    // here: it must not deny the daily skip-list check that runs either way.
    const root = mountDouble()
    renderSettings(
      root as unknown as HTMLElement,
      {
        settings: { ...firstRun, automatic: false },
        artifact: seed,
        compiledOut: COMPILED_OUT,
        onDevice: false,
        notice: null
      },
      NOTHING
    )
    const text = root.textContent
    expect(text).toContain("Nothing about the pages you read is sent as you browse")
    expect(text).toContain("daily skip-list check")
  })

  it("the destructive control and the closing line both stay true about the download", () => {
    // Trap 3: these two sentences were rewritten because the feed made the old
    // ones false — the button used to list only the harvest cache, and the
    // footer used to say everything on this page happens on this device, two
    // lines under a version number a daily download produced. Nothing locked
    // either, so reverting them would have stayed green.
    const text = drawn().textContent
    expect(FORGETTING.everything.says).toBe(
      "Everything Parle knows about discussions it found, built from pages you had already opened — and the downloaded skip-list update, which comes back within a day."
    )
    expect(FOOTER.source).toBe(
      "Parle is AGPL-3.0. Every choice on this page is made and kept on this device."
    )
    expect(text).toContain(FORGETTING.everything.says)
    expect(text).toContain(FOOTER.source)
  })

  it("names the daily skip-list download instead of denying every request", () => {
    // Privacy §9 binds the settings page to the policy in the same release:
    // §1.7 documents a daily static fetch from the project's own repository,
    // so the page that used to say "the extension never contacts one" must
    // say what actually runs — and say what the request does not carry.
    const text = drawn().textContent
    expect(text).toContain("skip-list update")
    expect(text).toContain("at most once a day")
    expect(text).not.toContain("the extension never contacts one")
  })

  it("states the three unsupportable claims only ever as refusals", () => {
    // They moved here from the first-run screen rather than being deleted: that
    // screen is now under a hundred words, and this page is where the reader
    // who follows its link finds the rest. Each one appears exactly once, and
    // only inside a sentence that begins by refusing it.
    const text = drawn().textContent
    expect(text).toContain("Three things Parle will not claim")
    for (const claim of [
      "your browsing is private",
      "we protect sensitive categories",
      "we exclude addresses carrying credentials"
    ]) {
      expect(text).toContain(`Not \u201c${claim}\u201d`)
      expect(text.split(claim)).toHaveLength(2)
    }
  })

  it("does not claim to send addresses to a service this build cannot contact", () => {
    // The standing paragraph names all three sites, because that is what Parle
    // does by design. ADR 0001 compiles X out of this artifact entirely, so the
    // paragraph on its own is inaccurate about the build the reader is running.
    const text = drawn().textContent
    expect(text).toContain("the code that would ask X is not included at all")
    expect(text).toContain("Hacker News and Reddit that see the addresses")
  })

  it("does not describe the toolbar as a way past a Network the reader switched off", () => {
    // ADR 0014: off means off, including for an explicit ask. The sentence that
    // promises the toolbar works everywhere is about pages, not about sites we
    // were told to stop asking.
    const text = drawn().textContent
    expect(text).toContain("Turn any of these off and Parle stops asking it")
    expect(text).toContain("whether or not you open the panel")
  })
})

/**
 * Connecting a Provider, and the one sentence about the key that may not be softened.
 *
 * MV3 has nowhere private to put a credential — ADR 0014 already recorded that
 * as the reason a Network refresh token would be a *worse* store than the
 * browser's own cookie jar — so the page has to say it. A settings screen that
 * implied protection it cannot provide would be worse than one that said
 * nothing, because the reader would act on it.
 */
describe("connecting a Provider", () => {
  it("says the product works without one", () => {
    // ADR 0004: AI is an upgrade, not a dependency, and the section that asks
    // for a key is the one place that claim is easiest to quietly drop.
    expect(drawn().textContent).toContain("Everything else on this page works whether or not you do")
  })

  it("says where a pasted key actually lives, in the reader's own words", () => {
    const text = drawn().textContent
    expect(text).toContain("as ordinary text")
    expect(text).toContain("anything that can read your browser's profile")
    // And it must not claim any of the protections it does not have.
    expect(text.toLowerCase()).not.toContain("encrypted")
    expect(text.toLowerCase()).not.toContain("stored securely")
    expect(text.toLowerCase()).not.toContain("kept safe")
  })

  it("says what a summary costs before offering to turn one on", () => {
    // The comments of the discussions on a page go to a third party. It is more
    // than a lookup sends, so it is said where the choice is made.
    expect(drawn().textContent).toContain("sends them to whatever you connect")
    expect(drawn().textContent).toContain("the panel asks first")
  })

  it("never shows a saved key back to the reader", () => {
    const saved = withProviderConnection(
      withByok(firstRun, { apiKey: "sk-secret-value", model: "m" }),
      "byok"
    )
    const root = mountDouble()
    renderSettings(
      root as unknown as HTMLElement,
      { settings: saved, artifact: seed, compiledOut: COMPILED_OUT, onDevice: false, notice: null },
      NOTHING
    )
    // Not in the text, and not in a field's value either — a filled password
    // box is in the accessibility tree, in a screenshot, and in whatever a
    // password manager decides to do with it.
    expect(root.textContent).not.toContain("sk-secret-value")
    expect(root.all().some((node) => node.textContent.includes("A key is saved"))).toBe(false)
  })

  it("offers the browser's own model only where there is one", () => {
    // `downloadable` is not `available`: choosing a Provider must not be what
    // starts a multi-gigabyte download.
    expect(drawn(false).textContent).toContain("This browser does not offer one")
    expect(drawn(true).textContent).toContain("This browser has one ready")
  })

  it("labels the ChatGPT seam as the rough edge it is", () => {
    // ADR 0014: the sign-in flow is unresolved, and Safari has no
    // `browser.identity` at all. Inventing one here would be inventing the part
    // most likely to be wrong, so the page says a token is pasted for now.
    const text = drawn().textContent
    expect(text).toContain("There is no sign-in button for it yet")
    expect(text).toContain("A rough edge, labelled as one.")
  })
})

describe("the first-run page", () => {
  it("uses no engineering vocabulary", () => {
    checkProse(firstRunProse)
  })

  it("is short enough to be read before the choice under it", () => {
    // It was ~410 words, including a section headed "Three things Parle will
    // not claim". A disclosure nobody finishes reading is not one that was
    // made, so the target is a screen a person takes in at a glance — and the
    // detail that was cut is on the settings page, one link away, not gone.
    const words = firstRunProse.trim().split(/\s+/).length
    expect(words).toBeLessThan(100)
  })

  it("says where the address goes, by name, before anything is sent", () => {
    expect(firstRunProse).toContain(
      "Parle sends the address of the page you are reading to Hacker News and Reddit"
    )
    expect(firstRunProse).toContain("It is not anonymous.")
  })

  it("says the skip list will miss things, in one clause", () => {
    // ADR 0005: protection by enumeration fails on whatever was not
    // enumerated, and this is the only place the reader is told so before
    // deciding. A paragraph was cut down to a clause; the clause stays.
    expect(firstRunProse).toContain("a list, so it will miss things")
  })

  it("says what is true of this build, not only of Parle in general", () => {
    expect(FIRST_RUN.absent(["X"])).toBe("X is not in this build at all.")
    // And says nothing at all once there is nothing compiled out, rather than
    // a sentence somebody would then have to maintain.
    expect(FIRST_RUN.absent([])).toBeNull()
  })

  it("leaves the reader a way to the long version", () => {
    expect(FIRST_RUN.more).toContain("long version")
  })

  it("offers two answers and preselects neither", () => {
    expect(FIRST_RUN.said.undecided).toContain("Nothing is being looked up")
    // The shell ships empty: both buttons are drawn by `main.ts` with no class
    // at all, and `chosen` is only ever added from a decision the background
    // reported. There is no markup here that could preselect one.
    expect(welcomeShell).toContain('id="first-run"')
    expect(welcomeShell).not.toContain('class="chosen"')
    expect(welcomeShell).not.toContain("<button")
  })

  it("names the toolbar button in the one state where it is the only way in", () => {
    // "Only when I ask" is the state where the toolbar button is the reader's
    // whole remaining way in, so naming it is not decoration. The assertion is
    // on the three things that make the sentence actionable rather than on one
    // substring: that nothing goes out as they browse, where the button is, and
    // that the choice is not a one-way door.
    expect(FIRST_RUN.said.manual).toContain("toolbar")
    expect(FIRST_RUN.said.manual).toMatch(/Parle button/)
    // "about the pages you read", not the older blanket "nothing is sent":
    // the daily skip-list check of privacy §1.7 runs in this state too, and
    // the sentence now says so rather than denying it.
    expect(FIRST_RUN.said.manual).toMatch(/nothing about the pages you read is sent as you browse/i)
    expect(FIRST_RUN.said.manual).toMatch(/skip-list update/i)
    // The automatic line is the one a reader hears before the daily GET
    // starts running, so privacy §9's "first-run and settings in the same
    // release" applies to it most of all.
    expect(FIRST_RUN.said.automatic).toMatch(/skip-list update/i)
    expect(FIRST_RUN.said.manual).toContain("Settings")
  })
})
