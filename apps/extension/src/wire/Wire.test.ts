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
  LookAnyway,
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
 * hand-written guard stays honest.
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
    for (const ask of [
      ...EVERY_ASK,
      Watch(null),
      Decide(false),
      Forget("everything")
    ]) {
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
    // The native side-panel Ask is gone. A leftover frame must not become a
    // Watch or anything else the background would act on.
    expect(hearAsk({ _tag: "OpenAside" })).toBeNull()
  })
})

describe("reading what the background says", () => {
  it("accepts a whole Panel and refuses a partial one", () => {
    const word = Standing(7, emptyPanel, DEFAULT_MARK_PARK)
    const heard = hearWord(JSON.parse(JSON.stringify(word)))
    expect(heard?._tag === "Standing" ? heard.tabId : null).toBe(7)
    expect(heard?._tag === "Standing" ? heard.markPark : null).toEqual(DEFAULT_MARK_PARK)
    expect(hearWord({ _tag: "Standing", tabId: 7 })).toBeNull()
    expect(hearWord({ _tag: "Standing", tabId: "7", panel: emptyPanel })).toBeNull()
    expect(hearWord({ _tag: "Standing", panel: { linked: [] }, tabId: 1 }))
      .toBeNull()
  })

  it("defaults a missing mark park to the historic top-right corner", () => {
    const heard = hearWord({
      _tag: "Standing",
      tabId: 7,
      panel: emptyPanel
    })
    expect(heard?._tag === "Standing" ? heard.markPark : null).toEqual(DEFAULT_MARK_PARK)
  })

  it("drops the retired native-panel words rather than half-applying them", () => {
    expect(hearWord({ _tag: "AsideVisibility", open: true })).toBeNull()
    expect(hearWord({
      _tag: "Standing",
      tabId: 7,
      panel: emptyPanel,
      aside: "native"
    })?._tag).toBe("Standing")
  })

  it("round-trips the reader's decision, and refuses one it does not recognise", () => {
    for (const decision of ["undecided", "automatic", "manual"] as const) {
      expect(hearWord(JSON.parse(JSON.stringify(Told(decision))))).toEqual(Told(decision))
    }
    expect(hearWord({ _tag: "Told", decision: "maybe" })).toBeNull()
    expect(hearWord({ _tag: "Told" })).toBeNull()
  })
})
