import { describe, expect, it } from "vitest"
import { emptyPanel } from "../view/Panel.ts"
import type { Ask } from "./Wire.ts"
import { DEFAULT_MARK_PARK } from "../view/MarkPark.ts"
import {
  Decide,
  Forget,
  Harvested,
  hearAsk,
  hearWord,
  isOpenAside,
  LookAnyway,
  OpenAside,
  OpenDisclosure,
  OpenOut,
  OpenSettings,
  ParkMark,
  PauseSite,
  ResumeSite,
  SettingsChanged,
  Sighted,
  Standing,
  Told,
  ReadDiscussion,
  Summarise,
  Watch
} from "./Wire.ts"

/**
 * One entry per `_tag`, checked against the union rather than trusted.
 *
 * The list used to be hand-kept and had drifted — `OpenSettings`, `PauseSite`,
 * `ResumeSite` and `Forget` were all on the wire and none of them was here. The
 * `Record` makes leaving a new Ask out a compile error, which is the only way a
 * hand-written guard stays honest. It caught `OpenAside` on the first run.
 */
const EVERY: Record<Ask["_tag"], Ask> = {
  Watch: Watch(7),
  Sighted: Sighted("https://example.com/", "A piece", "https://news.ycombinator.com/"),
  OpenOut: OpenOut("https://news.ycombinator.com/item?id=1"),
  LookAnyway: LookAnyway(),
  Summarise: Summarise(),
  ReadDiscussion: ReadDiscussion("hackernews 41293011"),
  Decide: Decide(true),
  OpenDisclosure: OpenDisclosure(),
  OpenAside: OpenAside(),
  PauseSite: PauseSite("example.com"),
  ResumeSite: ResumeSite("example.com"),
  OpenSettings: OpenSettings(),
  SettingsChanged: SettingsChanged(),
  Forget: Forget("lookup-record"),
  Harvested: Harvested("hackernews", "https://news.ycombinator.com/", "<html></html>"),
  ParkMark: ParkMark({ x: 0.2, y: 0.8 })
}

const EVERY_ASK: ReadonlyArray<Ask> = Object.values(EVERY)

describe("reading what a surface says", () => {
  it("round-trips every Ask", () => {
    for (const ask of [...EVERY_ASK, Watch(null), Decide(false), Forget("everything")]) {
      // The wire carries these through structured clone, so what goes in must
      // come back out unchanged — a field silently dropped here is a Reading
      // boundary that never fires.
      expect(hearAsk(JSON.parse(JSON.stringify(ask)))).toEqual(ask)
    }
  })

  it("drops a frame it cannot read instead of half-applying it", () => {
    expect(hearAsk(null)).toBeNull()
    expect(hearAsk({ _tag: "Nonsense" })).toBeNull()
    expect(hearAsk({ _tag: "OpenOut" })).toBeNull()
    expect(hearAsk({ _tag: "Watch", tabId: "seven" })).toBeNull()
    expect(hearAsk({ _tag: "Sighted", address: "https://x.test/" })).toBeNull()
    // Never guessed. This is the one answer the extension is obliged to have
    // asked for out loud, so a frame that does not carry it is dropped rather
    // than defaulted in either direction.
    expect(hearAsk({ _tag: "Decide" })).toBeNull()
    expect(hearAsk({ _tag: "Decide", automatic: "yes" })).toBeNull()
  })

  /**
   * The one Ask read twice: once here, and once by the raw port listener in
   * `platform/Extension.ts`, which cannot wait for a fiber to tell it.
   *
   * `isOpenAside` has to agree with `hearAsk` over the whole wire or the panel
   * opens on the wrong message — or, worse, on none. It is checked against
   * every Ask there is rather than against a couple of examples, so a future
   * tag cannot quietly start opening a side panel.
   */
  it("recognises the gesture-bound Ask, synchronously, and only it", () => {
    expect(isOpenAside(OpenAside())).toBe(true)
    expect(isOpenAside(JSON.parse(JSON.stringify(OpenAside())))).toBe(true)
    for (const ask of EVERY_ASK) {
      expect(isOpenAside(ask)).toBe(ask._tag === "OpenAside")
    }
    expect(isOpenAside(null)).toBe(false)
    expect(isOpenAside({})).toBe(false)
    expect(isOpenAside("OpenAside")).toBe(false)
  })
})

describe("reading what the background says", () => {
  it("accepts a whole Panel and refuses a partial one", () => {
    const word = Standing(7, emptyPanel, "in-page", DEFAULT_MARK_PARK)
    const heard = hearWord(JSON.parse(JSON.stringify(word)))
    expect(heard?._tag === "Standing" ? heard.tabId : null).toBe(7)
    expect(heard?._tag === "Standing" ? heard.markPark : null).toEqual(DEFAULT_MARK_PARK)
    expect(hearWord({ _tag: "Standing", tabId: 7 })).toBeNull()
    expect(hearWord({ _tag: "Standing", tabId: "7", panel: emptyPanel, aside: "in-page" })).toBeNull()
    expect(hearWord({ _tag: "Standing", panel: { linked: [] }, tabId: 1, aside: "in-page" }))
      .toBeNull()
  })

  it("defaults a missing mark park to the historic top-right corner", () => {
    const heard = hearWord({
      _tag: "Standing",
      tabId: 7,
      panel: emptyPanel,
      aside: "in-page"
    })
    expect(heard?._tag === "Standing" ? heard.markPark : null).toEqual(DEFAULT_MARK_PARK)
  })

  /**
   * Which surface the mark opens is carried, never inferred.
   *
   * The two wrong guesses fail in opposite directions and both are silent:
   * assume `native` where there is none and the mark does nothing at all;
   * assume `in-page` on Chrome and the reader gets the same Discussions twice,
   * once beside the article and once on top of it. So a frame that does not
   * say is dropped, like `Decide` and `Forget` above.
   */
  it("carries what the browser can put beside the page, and never guesses it", () => {
    for (const kind of ["native", "in-page"] as const) {
      const word = Standing(7, emptyPanel, kind, DEFAULT_MARK_PARK)
      const heard = hearWord(JSON.parse(JSON.stringify(word)))
      expect(heard?._tag === "Standing" ? heard.aside : null).toBe(kind)
    }
    expect(hearWord({ _tag: "Standing", tabId: 7, panel: emptyPanel })).toBeNull()
    expect(hearWord({ _tag: "Standing", tabId: 7, panel: emptyPanel, aside: "sidebar" })).toBeNull()
    expect(hearWord({ _tag: "Standing", tabId: 7, panel: emptyPanel, aside: true })).toBeNull()
  })

  it("round-trips the reader's decision, and refuses one it does not recognise", () => {
    for (const decision of ["undecided", "automatic", "manual"] as const) {
      expect(hearWord(JSON.parse(JSON.stringify(Told(decision))))).toEqual(Told(decision))
    }
    expect(hearWord({ _tag: "Told", decision: "maybe" })).toBeNull()
    expect(hearWord({ _tag: "Told" })).toBeNull()
  })
})
