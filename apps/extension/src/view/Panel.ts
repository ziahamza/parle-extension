/**
 * What a surface draws — the shape, and the small pure things it needs.
 *
 * This module has no runtime dependencies at all, and that is the point. It is
 * the type that crosses the wire, so it is imported by the background *and* by
 * the script injected into the reader's page; anything with an import here ends
 * up in that injected script. ADR 0003 makes iOS the constraining platform, so
 * the derivation — which needs `@parle/domain` and therefore Effect — lives in
 * `panelOf.ts` and runs in the background, where it is loaded once.
 *
 * Sending a derived Panel rather than a `Reading` also puts the two rules that
 * matter in exactly one place. Linked, Passing and Topical are three fields
 * here, not one list with a tag, so a surface *cannot* blend them: there is no
 * expression that renders them together without deliberately concatenating
 * three arrays. And `accounts` is a complete list of Places on every frame, so
 * an empty panel is structurally incapable of being silent about why.
 *
 * **Every degraded capability is a field with words in it, not an absence.**
 * ADR 0011 makes each one a state the panel renders rather than an error it
 * throws, and the way that is kept true is that this type has no shape in which
 * a surface can end up with nothing to say: `restraint`, `waitingOn`,
 * `foundNothing`, `couldNotAsk`, `index` and `digest` between them cover every
 * arrangement in which there are no rows.
 *
 * The strings in here are the strings a reader sees. They are written here and
 * in `panelOf.ts` in plain words — never in the project's engineering
 * vocabulary, which `render.test.ts` enforces against the rendered DOM.
 */
import type { Network } from "@parle/domain/Network"

export type Tier = "linked" | "passing"

export type Tone = "waiting" | "quiet" | "found" | "refused" | "withheld" | "garbled"

export interface Row {
  readonly key: string
  readonly network: Network
  readonly networkName: string
  readonly title: string
  readonly score: number
  readonly commentCount: number
  readonly age: string
  readonly permalink: string
  readonly tier: Tier
  /**
   * How many further times this same page was posted to this same Network,
   * folded into this row.
   *
   * One article submitted to Hacker News five times is one conversation and
   * four reposts nobody replied to, and drawing five rows makes the reader do
   * the sorting. Zero on every row that folded nothing, so a surface never has
   * to distinguish "no repeats" from "we did not check".
   */
  readonly alsoSubmitted: number
  /**
   * What is actually being said in this Discussion, once the reader opens it.
   *
   * A row is a title and two numbers, which tells a reader that a conversation
   * exists and nothing about what is in it — so the only way to find out was to
   * leave. That is the wrong shape for a product whose whole claim is telling
   * you what the internet said about the page in front of you.
   *
   * `null` until the reader opens the row, because reading a thread's comments
   * is a request per Discussion against the reader's own IP (ADR 0014) and
   * nothing spends that on a page they only glanced at. `Reading` while it is
   * in flight, so the row can say so rather than sitting still.
   */
  readonly comments: RowComments | null
}

/** A Discussion's own words, as far as the panel shows them. */
export type RowComments =
  | { readonly _tag: "Reading" }
  /** The Network could not be read. Never cached, and never drawn as silence. */
  | { readonly _tag: "Unreadable" }
  | {
    readonly _tag: "Read"
    readonly comments: ReadonlyArray<PanelComment>
    /** More were said than are shown here, so the row can say "and N more". */
    readonly beyond: number
  }

export interface PanelComment {
  readonly author: string
  readonly text: string
  readonly age: string
}

/**
 * Discussions kept off the front of the panel, and the whole reason why.
 *
 * This is the ONLY thing in the product that keeps a Discussion the reader
 * could otherwise see off the screen, so it is a value with words and a count
 * in it rather than a filter applied upstream. ADR 0005's rule is that a
 * mechanism which silently hides Discussions is worse than one that costs
 * requests, because a false negative is invisible; the answer to that is that
 * this one is not silent — the count is stated, the reason is stated, and the
 * rows are right here, one click away, never re-fetched.
 *
 * It fires on a **Front Door**: a Subject whose address is a site's entrance
 * rather than a document, recognised from the shape of that address and the
 * disagreement of its Discussions' titles. `facebook.com` accumulates
 * conversations about five different events at Facebook; a Bank of America blog
 * post accumulates conversations about one blog post. Only the first is folded,
 * and only the part of it older than thirty days — see `FrontDoor.HORIZON_MS`.
 */
export interface Folded {
  /** What the reader is told before they open it. The whole sentence. */
  readonly says: string
  /** The one control. Never "dismiss" — this only ever opens. */
  readonly label: string
  /** The Discussions themselves, in the order they would have been drawn. */
  readonly rows: ReadonlyArray<Row>
}

/** One Place, and what it has to say right now. */
export interface Account {
  readonly place: string
  readonly standing: string
  readonly tone: Tone
}

/** A quiet aside: true, worth saying, and not what the reader came for. */
export interface Note {
  readonly tone: Tone
  readonly text: string
}

/**
 * Why Parle is not looking this page up, and what the reader can do about it.
 *
 * `kind` exists so a surface can offer the right way out rather than parsing
 * the sentence: an excluded page can be looked up anyway on one click, a page
 * that is not a public web address cannot be, and a reader who has switched
 * automatic lookups off wants a different button from one who has not yet been
 * asked. `says` is the whole of what is shown; nothing appends to it.
 */
export interface Restraint {
  readonly kind:
    | "undecided"
    | "automatic-off"
    | "excluded"
    | "site-paused"
    | "over-budget"
    /**
     * Every Network there was to ask is one the reader switched off.
     *
     * Separate from `switched-off` because the way out is different, and
     * offering the wrong one is a button that does nothing. An explicit Ask
     * overrides the exclusion list, a pause and manual mode — but ADR 0014
     * requires a Network switched off to STAY off, so `LookupPolicy` checks
     * `killSwitched` before it looks at whose initiative the Ask was on.
     * "Look it up anyway" therefore cannot help here; the settings page can.
     */
    | "networks-off"
    | "switched-off"
    /** Every Network Place was held back because this is a site's front page. */
    | "front-door"
    | "not-a-web-page"
  readonly says: string
}

/**
 * Where a Finding's evidence can be read, as a link the reader can follow.
 *
 * ADR 0006 permits a Digest to report a claim as contested only because the
 * flag is checkable: "we are not claiming the page is wrong, we are claiming
 * someone said so, and here is who". A pointer the reader cannot follow is not
 * that — so this is a resolved address and a label, never an identifier, and
 * the ADR's own consequence section says a flag without a visible source is not
 * shippable.
 *
 * `comment` distinguishes "this particular person said this" from "this is what
 * the thread was about". Both are legitimate; only the first can be checked in
 * one click, which is why a contested Finding is required to carry one.
 */
export interface Source {
  readonly label: string
  readonly permalink: string
  readonly comment: boolean
}

/** One attributed statement, with everywhere it can be checked. */
export interface FindingView {
  readonly statement: string
  /**
   * Someone in these Discussions disputed a claim the page makes.
   *
   * Never "this is false". ADR 0006 records that most people read the word as a
   * verdict and requires the copy and the visual treatment to work against
   * that; `render.ts` marks it as an objection with a source rather than as a
   * warning.
   */
  readonly contested: boolean
  readonly sources: ReadonlyArray<Source>
}

/**
 * What the reader can do about the Digest, if anything.
 *
 * `says` is shown before the act, never after — a Digest costs several requests
 * for comment bodies and some of the reader's own Provider quota, and both are
 * things they are owed a sentence about in advance.
 */
export interface DigestOffer {
  readonly kind: "write" | "again" | "connect"
  readonly label: string
  readonly says: string
}

/**
 * The Digest slot, in every state it has.
 *
 * `says` is never empty except in the one case where the panel is not drawing a
 * Digest slot at all, so ADR 0011 holds here as it does everywhere else on this
 * type: there is no arrangement in which the reader is shown an absence.
 */
export interface DigestView {
  readonly says: Note
  readonly findings: ReadonlyArray<FindingView>
  /** Some of what the model wrote could not be kept. Said, never hidden. */
  readonly partial: boolean
  /** Who wrote it, and on what — shown once a Digest exists. */
  readonly wrote: string | null
  readonly offer: DigestOffer | null
}

export interface Panel {
  readonly heading: string
  readonly address: string
  /** Set when we will not look this page up, with the reason the reader is owed. */
  readonly restraint: Restraint | null
  readonly linked: ReadonlyArray<Row>
  readonly passing: ReadonlyArray<Row>
  /**
   * What was kept off the front of the panel, and why. `null` on every page
   * where nothing was.
   *
   * Deliberately NOT merged into the three tiers with a per-row flag. A row
   * with a `hidden` boolean is a row three surfaces have to remember to check,
   * and the one that forgets shows it anyway; a row that is not in `linked` is
   * one no surface can draw by accident. It is also what makes `foundCount`
   * honest — the toolbar's count and the panel's rows agree because they are
   * the same list.
   */
  readonly folded: Folded | null
  /**
   * Every Place, on every frame. Never abridged.
   *
   * There used to be a second, shorter list beside this one — the subset worth
   * saying loudly — because two surfaces were both drawing the account and one
   * of them had no room. There is one account surface now, it has room, and a
   * subset that can disagree with the whole is a way for the two to drift.
   */
  readonly accounts: ReadonlyArray<Account>
  readonly stillLooking: boolean
  /**
   * Who has still to answer, by name.
   *
   * They answer in waves and at wildly different speeds, so "still looking" as
   * one word over the whole page tells the reader nothing about whether to keep
   * waiting. Naming them turns a spinner into a fact.
   */
  readonly waitingOn: ReadonlyArray<string>
  /** Somebody answered, and had nothing. Evidence about the world. */
  readonly foundNothing: boolean
  /** Nobody answered at all — refused, or never asked. Evidence about us. */
  readonly couldNotAsk: boolean
  /**
   * The Networks that really answered, by name.
   *
   * Carried rather than assumed because "Hacker News and Reddit both answered"
   * is a claim, and it was being made on pages where one of them had been
   * switched off, refused, or was never in the build. A sentence that names who
   * answered can only be written from the list of who answered.
   */
  readonly answeredBy: ReadonlyArray<string>
  /** What the shipped list of already-discussed pages can do for us, when it matters. */
  readonly index: Note | null
  /**
   * A Network had more to say than Parle asked to hear, so this list is a
   * floor rather than a total. `null` on every page where it was not.
   *
   * The only thing on this type that qualifies the *completeness* of the rows
   * rather than explaining their absence, and it is here because ADR 0005's
   * rule has a second edge nobody had drawn: a panel that shows twelve
   * Discussions with no mark tells the reader there are twelve. If we can only
   * ever see the first N, the panel has to be able to say so — and on the
   * pages where it says nothing, that silence is now a measured claim rather
   * than an assumption. Measured at 1.6% of discussed pages.
   */
  readonly windowed: Note | null
  /** Whether Parle looks pages up without being asked. */
  readonly automatic: boolean
  readonly digest: DigestView
}

export const anyRows = (panel: Panel): boolean =>
  panel.linked.length + panel.passing.length > 0

export const foundCount = (panel: Panel): number =>
  panel.linked.length + panel.passing.length

/**
 * What the toolbar badge says. Empty means "say nothing at all".
 *
 * A Front Door with nothing fresh therefore wears no badge, because
 * `foundCount` counts what is drawn and the folded rows are not. That is the
 * intended reading: a number on the toolbar is a promise that opening it shows
 * that many conversations about the page in front of you, and "26" on
 * `facebook.com` is a promise the panel cannot keep. The toolbar surface behind
 * the button still says the whole of it, in words, on the same click.
 */
export const badgeOf = (panel: Panel): string => {
  if (panel.restraint !== null) return ""
  const found = foundCount(panel)
  if (found > 0) return String(Math.min(found, 99))
  return panel.stillLooking ? "…" : ""
}

/**
 * Age in the coarsest unit that is still true.
 *
 * Coarse on purpose: these numbers were observed at a moment no Network states,
 * so a minute-precise age would claim a precision we do not have.
 */
export const ageOf = (postedAt: number, now: number): string => {
  if (postedAt <= 0) return ""
  const seconds = Math.max(0, Math.floor((now - postedAt) / 1000))
  if (seconds < 90) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 24) return `${months}mo`
  return `${Math.floor(days / 365)}y`
}

export const emptyPanel: Panel = {
  heading: "",
  address: "",
  restraint: null,
  linked: [],
  passing: [],
  folded: null,
  accounts: [],
  stillLooking: true,
  waitingOn: [],
  foundNothing: false,
  couldNotAsk: false,
  answeredBy: [],
  index: null,
  windowed: null,
  automatic: false,
  digest: { says: { tone: "quiet", text: "" }, findings: [], partial: false, wrote: null, offer: null }
}
