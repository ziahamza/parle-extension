/**
 * The facts about this *installation* that a panel needs and a Reading cannot
 * carry.
 *
 * A Reading is one reader's encounter with one page. Two things the panel has
 * to say are not about the page at all: whether the reader has yet been told
 * what this extension sends and answered the question, and what the shipped
 * list of already-discussed pages can currently do for them. Both are the same
 * on every tab, both change rarely, and folding either into a per-tab value
 * would mean rebuilding every tab's state to record a fact about none of them.
 *
 * They travel together because they are read together, at exactly one call
 * site: the background derives a panel from `(Reading, now, Surroundings)`.
 *
 * This module imports one type and no runtime. Its `Decision` crosses the wire
 * — the disclosure page is told the current one — and anything with a runtime
 * import here would end up in the script injected into the reader's page
 * (ADR 0003).
 */
import type { NetworkSwitches, ReaderSettings } from "../settings/Settings.ts"

/**
 * Whether the reader has been shown what Parle sends and to whom, and what they
 * said.
 *
 * `undecided` is the state of a fresh install and it is a *closed* one: nothing
 * automatic happens in it. The disclosure is not a banner over a decision
 * already taken, so "we have not asked yet" and "they said no" have to be
 * different values — the first owes the reader the question, the second does
 * not.
 */
export type Decision = "undecided" | "automatic" | "manual"

/**
 * What the shipped Discussion Index can do for us right now.
 *
 * Absent and stale are genuinely different states and want different words,
 * which is why this is not a boolean and not a nullable timestamp.
 *
 * *Absent* has a privacy consequence the reader can act on: with no index
 * there is nothing to consult before asking, so every page they open that is
 * not excluded produces real requests carrying its address. *Stale* has none —
 * an index may only ever make a lookup faster or make us distrust an unexpected
 * silence; it can never assert that nobody has discussed a page. An old one
 * therefore costs a little speed and nothing else, and telling the reader it
 * costs them coverage would be false.
 */
export type IndexStanding =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Stale"; readonly builtAt: number }
  | { readonly _tag: "Ready"; readonly builtAt: number }

/**
 * What the reader has connected to write Digests with, if anything.
 *
 * On `Surroundings` rather than on a Reading's Knowledge because it is a fact
 * about the INSTALLATION: it is the same on every tab, it changes when the
 * reader edits their settings rather than when a Lookup answers, and a copy
 * held per Enquiry would go stale the moment they pasted a key — leaving every
 * open panel saying "No Provider connected" about a key the settings page was
 * already showing. `Surroundings` is re-read on `SettingsChanged` and every
 * attached surface is redrawn, so this is correct within one message.
 *
 * `name` is the reader's own words for it, never an identifier. ADR 0004
 * forbids any caller branching on WHICH Provider is active; naming it in a
 * sentence is not branching on it, and a reader about to send their reading to
 * a third party is owed the name of the third party.
 */
export interface ProviderStanding {
  readonly connected: boolean
  readonly name: string
}

export interface Surroundings {
  readonly decision: Decision
  readonly provider: ProviderStanding
  /**
   * Which Networks the reader has left switched on.
   *
   * Here rather than only in `Settings` because the panel cannot otherwise tell
   * the reader why a Lookup did not happen. `Coverage` has ONE `WithholdingReason`
   * literal — `kill-switched` — for three different facts: the reader switched
   * this Network off, the reader switched automatic lookups off, and our own
   * switch is off. `@parle/domain` is closed, so the literal cannot be split.
   *
   * `LookupPolicy.permits` consults `Controls.killSwitched` (this field) BEFORE
   * the `initiative === "automatic"` branch that reads manual mode, so these two
   * fields together reconstruct which of the three it really was, in the order
   * the decision was actually taken. Without it the panel told a reader who had
   * just switched Reddit off that "automatic lookups are off" — which was not
   * true — and told a reader who had switched every Network off that it was
   * "not something you did".
   */
  readonly networks: NetworkSwitches
  readonly index: IndexStanding
}

/**
 * When the Discussion Index bundled with this build was compiled.
 *
 * `null`, honestly: `@parle/index-codec` is not wired into this artifact, so no
 * index ships in it. It is a literal rather than a lookup so that the day one
 * does ship, the only change is this number — and until then the panel tells
 * the reader the truth about what that costs them.
 */
export const INDEX_BUILT_AT: number | null = null

/** How long a shipped index is worth trusting before we say so. */
export const INDEX_TRUSTED_FOR_MS = 14 * 24 * 60 * 60 * 1000

export const shippedIndex = (now: number): IndexStanding =>
  INDEX_BUILT_AT === null
    ? { _tag: "Absent" }
    : now - INDEX_BUILT_AT > INDEX_TRUSTED_FOR_MS
    ? { _tag: "Stale", builtAt: INDEX_BUILT_AT }
    : { _tag: "Ready", builtAt: INDEX_BUILT_AT }

/**
 * What the reader has said, read off the one document that decides it.
 *
 * Derived rather than stored so the panel and `LookupPolicy` cannot disagree:
 * both are functions of the same two fields, and `Choices.choicesOf` computes
 * `manualOnly` from exactly this conjunction. A separate "have they seen the
 * disclosure" flag kept next to it is how a panel ends up saying automatic
 * lookups are on while the policy is refusing every one of them.
 */
export const decisionOf = (settings: ReaderSettings): Decision =>
  !settings.decided ? "undecided" : settings.automatic ? "automatic" : "manual"

/**
 * Everything about the install that a panel is derived against, from the one
 * document that decides it.
 *
 * One function rather than a literal at each call site, because the two fields
 * have to come from the SAME read: a `decision` from one read and `networks`
 * from another can disagree, and disagreeing is precisely how the panel ends up
 * attributing a Withholding to a switch that was not the one that fired.
 */
export const surroundingsOf = (
  settings: ReaderSettings,
  index: IndexStanding,
  provider: ProviderStanding
): Surroundings => ({
  decision: decisionOf(settings),
  provider,
  networks: settings.networks,
  index
})

/** Nothing connected — ADR 0004's ordinary case, and the default everywhere. */
export const noProvider: ProviderStanding = { connected: false, name: "no Provider" }

/** Every Network switched on — what a reader who has touched nothing has. */
export const everyNetworkOn: NetworkSwitches = { hackernews: true, reddit: true, x: true }

/** A fresh install: nobody has been asked anything, and nothing has been sent. */
export const untold: Surroundings = {
  decision: "undecided",
  provider: noProvider,
  networks: everyNetworkOn,
  index: { _tag: "Absent" }
}
