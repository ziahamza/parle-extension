/**
 * Turning a Reading into one frame of Panel. Pure, total, and where the two
 * rules that matter to the reader are actually enforced.
 *
 * **Linked and Topical are never blended.** A Discussion lands in exactly one
 * group, at its strongest tier, and the groups are separate arrays that no
 * later code path can merge. A Linked Mention says *this conversation is about
 * this page*; a Topical Mention says only *someone discussed this subject
 * matter*. Sorting them into one list by score — which is what every "just show
 * the best ones" instinct produces — silently promotes the weaker claim. It is
 * the same conflation ADR 0001's gate exists to prevent, arriving through the
 * front end instead of through the connector.
 *
 * **Every Place is accounted for on every frame.** `accounts` has one entry per
 * Place including the ones still pending, so an empty panel always says which
 * specific thing was true: nobody had anything, or Reddit refused, or we chose
 * not to ask and here is why. ADR 0011 makes each degraded capability a state
 * rather than an error, and this is the function that gives each one words.
 *
 * **"Nothing found" and "we could not ask" are separated here.** They are the
 * same absence on screen and opposite facts: the first is evidence about the
 * world and the second is evidence about us. Collapsing them tells a reader
 * that a page nobody could reach is a page nobody discussed, which is the one
 * lie this panel is built to avoid telling.
 *
 * Nothing here can fail. Every Reading renders as something.
 */
import type { BacklinkAnswer } from "@parle/backlinks/Backlink"
import { backlinksOf, isBounded } from "@parle/backlinks/Backlink"
import type { Holding } from "@parle/archive/Holding"
import { isSettled, windowedPlaces } from "@parle/domain/Coverage"
import type {
  Consultation,
  Coverage,
  Place,
  RefusalReason,
  WithholdingReason
} from "@parle/domain/Coverage"
import type { DigestOrigin } from "@parle/domain/Digest"
import type { Mention } from "@parle/domain/Mention"
import { type DiscussionId, discussionKey, type Network, permalinkOf } from "@parle/domain/Network"
import * as FrontDoor from "@parle/policy/FrontDoor"
import type { Observation } from "@parle/networks/Observation"
import type { Attributed, Opened } from "../enquiry/Knowledge.ts"
import { exclusionWords, hostOf } from "../policy/Grounds.ts"
import type { Reading } from "../reading/Reading.ts"
import type { IndexStanding, Surroundings } from "../reading/Surroundings.ts"
import { standingFor } from "./standingArtifact.ts"
import {
  type Account,
  ageOf,
  type ContextBlock,
  type ContextLine,
  type ContextLink,
  type DigestView,
  emptyPanel,
  type FindingView,
  type Folded,
  type Note,
  type Panel,
  type Restraint,
  type Row,
  type RowComments,
  type Source,
  type Tier,
  type Tone
} from "./Panel.ts"

const NETWORK_NAMES: Record<Network, string> = {
  hackernews: "Hacker News",
  reddit: "Reddit",
  x: "X",
  bluesky: "Bluesky",
  lemmy: "Lemmy",
  lobsters: "Lobsters"
}

export const networkName = (network: Network): string => NETWORK_NAMES[network]

/**
 * Why a Network could not answer, in as few words as keep it specific.
 *
 * Six words is fine; six vague words are not. "Refused us" and "rate-limiting
 * us" are opposite facts with opposite remedies, and folding either into
 * "unavailable" is the whole of what ADR 0011 forbids — the word that used to
 * precede these is gone for exactly that reason. Each of these is a fact about
 * the attempt and never about the page.
 */
const REFUSAL_WORDS: Record<RefusalReason, string> = {
  "not-signed-in": "you are not signed in",
  "rate-limited": "rate-limiting us",
  forbidden: "refused us",
  "timed-out": "no answer in time",
  interrupted: "interrupted",
  offline: "could not reach it"
}

const WITHHOLDING_WORDS: Record<WithholdingReason, string> = {
  excluded: "on the skip list",
  "site-paused": "you paused this site",
  // These three used to be one literal, and the panel guessed between them with
  // `switchedOffWords`. They are now distinct in `@parle/domain`, so each says
  // the true thing: a reader who switched Reddit off while leaving automatic
  // lookups on used to be told "automatic lookups are off" about Reddit.
  "network-off": "you switched it off",
  "manual-only": "automatic lookups are off",
  "kill-switched": "Parle's own switch is off",
  "compiled-out": "not in this build",
  "over-budget": "asked enough for now",
  "awaiting-linked-mention": "nothing links here yet",
  // Says which page it thinks this is, because that is the claim the reader
  // would want to disagree with. "not relevant here" would be the same
  // suppression with nothing to argue against.
  "front-door": "this is the site's front page"
}

/**
 * WHICH switch stopped this Place, given that `Coverage` has one word for all
 * of them.
 *
 * The order is not a preference — it is `LookupPolicy.permits` read back. That
 * function consults `Controls.killSwitched`, which is exactly
 * `!settings.networks[network]`, BEFORE it looks at `manualOnly`. So a Network
 * the reader switched off is withheld for that reason whatever else is true,
 * and only a Place whose Network is still on can have been stopped by manual
 * mode or by our own switch. Checking these in any other order would attribute
 * a Withholding to a branch that never ran.
 *
 * This mattered concretely: a reader who switched Reddit off and left automatic
 * lookups on was told "Reddit — not asked — automatic lookups are off".
 */
const switchedOffWords = (place: Place, surroundings: Surroundings): string => {
  if (place._tag === "Network" && !surroundings.networks[place.network]) {
    return `you switched ${networkName(place.network)} off`
  }
  if (surroundings.decision === "undecided") {
    return "you have not chosen whether Parle looks pages up"
  }
  if (surroundings.decision === "manual") return "automatic lookups are off"
  // Deliberately not "this is not something you did". A Place that is not a
  // Network — the reader's own device — cannot be attributed to any of the
  // three switches, and it lands here by elimination rather than by evidence.
  // The reassurance is the banner's to give, because that is the one derivation
  // that has looked at every Place before deciding whose doing it was.
  return "Parle's own switch is off"
}

const placeName = (place: Place): string =>
  place._tag === "Recall"
    ? "This device"
    : networkName(place.network)

/**
 * A selected conversation shows everything we read of it.
 *
 * Not a preview: the reader picked this thread out of a tab strip, which is a
 * statement that they want to read it. `@parle/networks` stops descending at
 * 400 comments, and `beyond` carries what the Network said was past that, so a
 * long thread ends with an honest count rather than a silent truncation.
 */
const COMMENTS_SHOWN = 400

/** What the reader's click turned up, in the words a row draws. */
const commentsOf = (opened: Opened | undefined, now: number): RowComments | null => {
  if (opened === undefined) return null
  if (opened._tag === "Reading") return { _tag: "Reading" }
  if (opened._tag === "Unreadable") return { _tag: "Unreadable" }
  const shown = opened.comments.slice(0, COMMENTS_SHOWN)
  return {
    _tag: "Read",
    comments: shown.map((comment) => ({
      id: comment.id,
      parentId: comment.parentId,
      depth: comment.depth,
      author: comment.author,
      text: comment.text,
      age: comment.postedAt === null ? "" : ageOf(comment.postedAt, now)
    })),
    // What we hold and did not draw, plus what the Network said was beyond what
    // we took. Never a guess: a row that says "and 40 more" on a thread we only
    // read six of would be inventing the size of the conversation.
    beyond: Math.max(0, opened.comments.length - shown.length) + opened.beyond
  }
}

const tierOf = (mention: Mention): Tier => mention._tag === "Linked" ? "linked" : "passing"

const STRENGTH: Record<Tier, number> = { linked: 2, passing: 1 }

const accountOf = (consultation: Consultation, surroundings: Surroundings): Account => {
  const place = placeName(consultation.place)
  switch (consultation._tag) {
    case "Pending":
      return { place, standing: "not asked yet", tone: "waiting" }
    case "Asking":
      return { place, standing: "still looking", tone: "waiting" }
    case "Answered":
      return {
        place,
        // "at least" is the whole disclosure in two words. A windowed answer
        // is a floor, and a bare count reads as a total.
        standing: consultation.windowed === true
          ? `at least ${consultation.mentions.length} found`
          : `${consultation.mentions.length} found`,
        tone: "found"
      }
    case "Silence":
      // Not "nothing". This Place answered, filled the window we asked for, and
      // none of what came back was this page — which is a fact about how far we
      // looked, not about whether anyone has been here.
      return consultation.windowed === true
        ? { place, standing: "nothing this far in", tone: "quiet" }
        : { place, standing: "nothing", tone: "quiet" }
    case "Refusal":
      // No "unavailable —" in front of it. That word said nothing the reason
      // did not say better, and prefixing every refusal with it made six
      // distinct facts look like one generic one.
      return { place, standing: REFUSAL_WORDS[consultation.reason], tone: "refused" }
    case "Garble":
      return { place, standing: `unreadable — ${consultation.detail}`, tone: "garbled" }
    case "Withholding":
      return {
        place,
        standing: `not asked — ${
          consultation.reason === "network-off" && consultation.place._tag === "Network"
            ? `you switched ${networkName(consultation.place.network)} off`
            : consultation.reason === "manual-only" && surroundings.decision === "undecided"
            ? "you have not chosen whether Parle looks pages up"
            : WITHHOLDING_WORDS[consultation.reason]
        }`,
        tone: "withheld"
      }
  }
}

/**
 * The one reason to give when every Network was held back for the same one.
 *
 * An excluded page is still a page we can name — that is what makes the
 * restraint visible, reasoned and overridable rather than an absence — so "we
 * are not looking here" is a fact about what came back rather than a separate
 * state. Derived only when EVERY Network Place agrees: one Network being
 * switched off while the others answer is a notice, not a banner across the
 * page.
 */
const heldBackFor = (
  consultations: ReadonlyArray<Consultation>
): WithholdingReason | null => {
  // `compiled-out` is a fact about the artifact, not about the page. A build
  // that ships without X would otherwise never show a banner on any page,
  // because one Place would always disagree with the others.
  const asked = consultations.filter((c) =>
    c.place._tag === "Network" && !(c._tag === "Withholding" && c.reason === "compiled-out")
  )
  if (asked.length === 0) return null
  const reasons = new Set(asked.map((c) => (c._tag === "Withholding" ? c.reason : "asked")))
  if (reasons.size !== 1) return null
  const only = [...reasons][0]
  if (only === undefined || only === "asked") return null
  return only
}

/**
 * The Networks a held-back page was actually about — the same set
 * {@link heldBackFor} had to agree over.
 *
 * `compiled-out` is dropped for the same reason it is dropped there: it is a
 * fact about the artifact rather than about this page or this reader, and
 * counting X in a build that has no X would make "the reader switched every
 * Network off" impossible to ever be true.
 */
const networksHeldBack = (
  consultations: ReadonlyArray<Consultation>
): ReadonlyArray<Network> => {
  const seen: Array<Network> = []
  for (const consultation of consultations) {
    if (consultation.place._tag !== "Network") continue
    if (consultation._tag === "Withholding" && consultation.reason === "compiled-out") continue
    if (!seen.includes(consultation.place.network)) seen.push(consultation.place.network)
  }
  return seen
}

/** "Hacker News and Reddit" — a list a person would read aloud. */
const listOf = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? names[0] ?? ""
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

/**
 * The same list under a negation, where "and" would read as the wrong claim.
 *
 * "Nothing has gone to A, B and C" can be read as "not to all three of them",
 * which is true of a page that went to two. "or" cannot. The empty case is a
 * word rather than a gap because this sentence is drawn before anything has
 * been asked, when there may be no Network in the account to name yet.
 */
const eitherOf = (names: ReadonlyArray<string>): string =>
  names.length === 0
    ? "any of them"
    : names.length === 1
    ? names[0] ?? ""
    : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`

/**
 * The whole of what a held-back page says, in the reader's words.
 *
 * These used to be harder than they look. `network-off`, `manual-only` and
 * `kill-switched` were a single literal, so this had to guess between them from
 * the reader's settings — and told someone who had switched Reddit off that
 * "automatic lookups are off". They are three literals now, and the difference
 * matters to the person reading: two are decisions they made and can undo, and
 * one is emphatically not something they did.
 */
const restraintFor = (
  reason: WithholdingReason,
  reading: Reading,
  surroundings: Surroundings,
  consultations: ReadonlyArray<Consultation>
): Restraint => {
  switch (reason) {
    case "excluded":
      return {
        kind: "excluded",
        says: exclusionWords(reading.excludedBecause, reading.address)
      }
    case "site-paused": {
      const host = hostOf(reading.address)
      return {
        kind: "site-paused",
        says: host === null
          ? "You paused Parle on this site."
          : `You paused Parle on ${host}.`
      }
    }
    case "network-off": {
      // Name the Networks rather than the setting: the reader turned specific
      // ones off, and which ones is the thing they need in order to undo it.
      const held = networksHeldBack(consultations)
      const off = held.filter((network) => !surroundings.networks[network])
      return {
        kind: "networks-off",
        says: off.length > 0
          ? `You switched ${listOf(off.map(networkName))} off. Nowhere left to ask.`
          : "Everywhere Parle would ask is switched off."
      }
    }
    case "manual-only":
      return surroundings.decision === "undecided"
        ? {
          kind: "automatic-off",
          says: "You have not chosen yet, so nothing was looked up."
        }
        : {
          // Still names where the address would go. The button underneath is
          // what sends it, and a reader is owed the destination before they
          // press it, not only on the screen they read once at install.
          kind: "automatic-off",
          says: `Automatic lookups are off. Nothing about this page has gone to ${
            eitherOf(
              networksHeldBack(consultations)
                .filter((network) => surroundings.networks[network])
                .map(networkName)
            )
          }.`
        }
    case "kill-switched":
      return {
        kind: "switched-off",
        says: "Switched off for now — not something you did."
      }
    case "over-budget":
      return {
        kind: "over-budget",
        says: "Parle has looked up a lot of pages and stopped for now."
      }
    case "compiled-out":
      return { kind: "switched-off", says: "This build cannot look pages up." }
    case "awaiting-linked-mention":
      return {
        kind: "switched-off",
        says: "Nothing links here yet, so Parle stopped there."
      }
    case "front-door":
      // Reachable only through X's gate now — a Lookup is never withheld for
      // this reason, which is the rule rather than an accident of ordering.
      return {
        kind: "front-door",
        says: `This looks like ${hostOf(reading.address) ?? "this site"}'s front page, so Parle only asked what links here.`
      }
  }
}

/**
 * The words for a fold, and the whole of what the reader is told before they
 * open it.
 *
 * Two sentences and a count, in that order, because the count is the part that
 * makes this checkable: "some Discussions were hidden" is a claim nobody can
 * argue with, and "8 Discussions link to this address" is one they can open and
 * judge in a second. Only the reader-facing vocabulary appears — Discussion —
 * and never the engineering word for what just happened.
 *
 * The two reasons wear different words because they are different observations
 * and only one of them would be true of the other. An incident title is a fact
 * about what was posted; divergence is a fact about how the postings relate.
 */
const foldWords = (
  site: string,
  because: "titles-disagree" | "incident",
  count: number,
  anythingFresh: boolean
): string => {
  const many = count === 1 ? "1 Discussion links" : `${count} Discussions link`
  const head = anythingFresh ? "" : `This looks like ${site}'s front page. `
  const tail = because === "incident"
    ? `at least one is about ${site} going down rather than about a page`
    : "they describe it differently each time"
  return `${head}${many} to this address, and ${tail}.`
}

/**
 * One page submitted to one Network five times is one conversation and four
 * reposts. Fold the reposts into a count on the conversation.
 *
 * This is safe to do HERE and nowhere else, because a Linked Mention means the
 * Discussion's own submitted URL is one of this Subject's Aliases — so two
 * Linked Mentions on one Network really are two postings of the same page. A
 * Topical Mention is a different thread about the same subject matter and a
 * Passing one is a different conversation entirely; folding either would merge
 * two conversations that have nothing to do with each other.
 *
 * **A thread anyone replied to is never folded away.** The test is the comment
 * count, not the score and not the rank, because the product is the
 * conversation: a submission with replies is one, a submission with none is a
 * repost. Where every posting is silent, the loudest survives and carries the
 * rest — the fact of repetition is kept in all cases, and only ever as a count
 * that no surface is obliged to make room for.
 *
 * `rows` must already be in the order the panel will draw them, because "the
 * loudest" is read off the front of each Network's run.
 */
const repeatsFolded = (rows: ReadonlyArray<Row>): ReadonlyArray<Row> => {
  const byNetwork = new Map<Network, Array<Row>>()
  for (const row of rows) {
    const held = byNetwork.get(row.network)
    if (held === undefined) byNetwork.set(row.network, [row])
    else held.push(row)
  }

  const folded = new Map<string, number>()
  const gone = new Set<string>()
  for (const postings of byNetwork.values()) {
    if (postings.length < 2) continue
    // A repost earns its own row by having drawn a conversation, not by having
    // drawn a single reply. `commentCount > 0` was the old test and it is why
    // `paulgraham.com/greatwork.html` drew seven rows: one thread with 432
    // comments, one with 69, and five reposts of the same essay with exactly
    // one comment each. Five rows that say nothing the first row does not.
    //
    // Measured against the 228-page corpus rather than guessed. A flat
    // substance floor — "fold anything under N points" — was tried first and
    // REFUSED: across 2,017 submissions it folds real pages' rows at almost
    // exactly the rate it folds front doors' (66% against 54% at one comment),
    // because the two distributions are the same shape. It carries no
    // information about whether a page is worth reading, and ADR 0005 does not
    // allow spending a real Discussion on a rule that cannot tell.
    //
    // What does discriminate is comparing a page's reposts to ITS OWN loudest
    // thread. A tenth of the conversation is the line, with an absolute floor
    // of ten comments so a genuinely busy thread survives beside a viral one.
    // On the corpus: greatwork 7 rows to 2, waitbutwhy 10 to 1, and the
    // Dunning-Kruger article keeps all 7 because all 7 are real. The most
    // substantial thing folded on any real page is 54 points and 7 comments.
    const loudest = postings[0]
    const spoken = loudest === undefined ? [] : postings.filter((row) =>
      row === loudest ||
      // `commentCount > 0` first, and not only for tidiness: when the loudest
      // posting drew nothing either, a tenth of nothing is nothing and every
      // silent repost would clear the bar.
      (row.commentCount > 0 &&
        (row.commentCount >= 10 || row.commentCount >= 0.1 * loudest.commentCount))
    )
    const kept = spoken.length > 0 ? spoken : postings.slice(0, 1)
    const quiet = postings.filter((row) => !kept.includes(row))
    const carrier = kept[0]
    if (quiet.length === 0 || carrier === undefined) continue
    for (const row of quiet) gone.add(row.key)
    folded.set(carrier.key, quiet.length)
  }

  if (gone.size === 0) return rows
  return rows
    .filter((row) => !gone.has(row.key))
    .map((row) => {
      const times = folded.get(row.key)
      return times === undefined ? row : { ...row, alsoSubmitted: times }
    })
}

/**
 * The sentence for a page where a Network had more than we asked to hear.
 *
 * ADR 0018 measured this at 1.6% of discussed pages, and almost always a site's
 * front door — so it must be rare on screen, and it must be there when it is
 * true. The wording carries three things and no more: **who** ran out of room,
 * that the list is a **floor** rather than a total, and that it is **our**
 * limit rather than the Network's. It never says "we may have missed
 * something", which is either always true or a claim we cannot support.
 *
 * Named Networks, not "a Network". A reader who can see which one it was can
 * go and check; one who cannot has been told only that the panel is
 * untrustworthy in some unspecified way.
 */
const windowedNote = (coverage: Coverage): Note | null => {
  const names: Array<string> = []
  for (const place of windowedPlaces(coverage)) {
    if (place._tag !== "Network") continue
    const name = networkName(place.network)
    if (!names.includes(name)) names.push(name)
  }
  if (names.length === 0) return null
  return {
    tone: "quiet",
    text: `${listOf(names)} had more here than Parle reads in one go, so this is at least this many, not all of them.`
  }
}

const indexNote = (index: IndexStanding): Note | null => {
  switch (index._tag) {
    case "Ready":
      return null
    case "Absent":
      // The privacy-relevant one, and the reason these are two states. With no
      // shipped list to consult first, there is nothing that could have told us
      // "nobody has posted this" before we asked — so every page that is not
      // excluded produces real requests carrying its address.
      return {
        tone: "withheld",
        text:
          "No offline list ships yet, so Parle asks about every page you open that is not skipped."
      }
    case "Stale":
      // Not a privacy fact and must not be dressed up as one. A list can only
      // ever save a request; it can never say nobody discussed a page. An old
      // one costs a little speed and nothing else.
      return {
        tone: "quiet",
        text:
          "Parle's offline list is out of date, so some pages are slower. Nothing is missed because of it."
      }
  }
}

/**
 * Where a Citation actually points, as an address the reader can open.
 *
 * ADR 0006's whole justification for allowing a contested flag is that the
 * reader can go and judge the objection themselves. That is only true if the
 * pointer resolves, so a Citation naming a comment resolves to THAT comment
 * rather than to the top of the thread: on Hacker News a comment is an item in
 * its own right, and on Reddit it is a fragment of the post's own permalink.
 *
 * Falls back to the Discussion when the shape is not one we can address. A link
 * to the conversation is worse than a link to the sentence and much better than
 * a link to nothing.
 */
const citationLink = (
  discussion: DiscussionId,
  comment: string | undefined
): string => {
  const thread = permalinkOf(discussion)
  if (comment === undefined || comment === "") return thread
  switch (discussion.network) {
    case "hackernews":
      return `https://news.ycombinator.com/item?id=${encodeURIComponent(comment)}`
    case "reddit":
      return `${thread}/_/${encodeURIComponent(comment)}`
    // Four Networks whose comments have no address of their own that we can
    // mint from an id alone — an X reply is a post, a Bluesky reply is an
    // at-uri needing its author's handle, a Lemmy comment lives on whichever
    // instance holds it, and a Lobsters comment is a fragment we do not read.
    // The thread is the honest fallback: a link to the conversation is worse
    // than a link to the sentence and much better than a link to nothing.
    case "x":
    case "bluesky":
    case "lemmy":
    case "lobsters":
      return thread
  }
}

/**
 * A Finding, with its evidence turned into links.
 *
 * The label is the Discussion's own title where we have it — the reader
 * recognises a thread by what it is called, not by which site it is on — and
 * the Network's name where we do not. Neither is ever an identifier: a pointer
 * the reader has to decode is one they will not follow.
 */
const findingView = (
  finding: Attributed,
  titles: ReadonlyMap<string, string>
): FindingView => ({
  statement: finding.statement,
  contested: finding.contested,
  sources: finding.citations.map((citation): Source => {
    const named = titles.get(discussionKey(citation.discussion))
    return {
      label: named === undefined || named === ""
        ? networkName(citation.discussion.network)
        : named,
      permalink: citationLink(citation.discussion, citation.comment),
      comment: citation.comment !== undefined && citation.comment !== ""
    }
  })
})

/** How a Digest records who wrote it, for the reader rather than for a log. */
const wroteWords = (origin: DigestOrigin): string =>
  origin._tag === "Local"
    ? `Written on this device, by ${origin.model}.`
    : "Written elsewhere and shared."

const NOTHING_TO_SUMMARISE: Note = {
  tone: "quiet",
  text: "Nothing links here yet — no conversation to summarise."
}

/**
 * The Digest slot, in whichever state it is actually in.
 *
 * Two facts are married here and they come from different places on purpose.
 * How much material there is belongs to the Subject and rides on Knowledge;
 * whether a Provider is connected belongs to the installation and rides on
 * Surroundings. Holding the second per-Enquiry is how a panel ends up saying
 * "No Provider connected" about a key the settings page is already showing.
 *
 * Nothing here fetches anything and nothing here can cause a fetch. The offer
 * is a button and a sentence; `Enquiry.summarise` is the only thing that
 * spends, and only the reader can reach it.
 */
const digestView = (
  reading: Reading,
  surroundings: Surroundings,
  settled: boolean,
  titles: ReadonlyMap<string, string>
): DigestView => {
  const quiet: DigestView = {
    says: { tone: "quiet", text: "" },
    findings: [],
    partial: false,
    wrote: null,
    offer: null
  }
  if (reading.standing._tag !== "Enquiring") return quiet
  const digest = reading.standing.knowledge.digest

  switch (digest._tag) {
    case "Ready": {
      // Said first, and said on every page whatever the Lookups turn up,
      // because it is not a conclusion about this page: nothing is connected,
      // and that is true before anyone answers. ADR 0004 makes it the ordinary
      // case rather than a failure, so it says what connecting would buy and
      // stops there.
      if (!surroundings.provider.connected) {
        return {
          ...quiet,
          says: {
            tone: "withheld",
            text: "No Provider connected. Connect one to get a Digest."
          },
          offer: { kind: "connect", label: "Connect a Provider", says: "" }
        }
      }
      // Still looking, and nothing linked so far. Saying anything now would
      // describe material that has not finished arriving, and the count would
      // change under the reader while they read it.
      if (!settled && digest.discussions === 0) return quiet
      if (digest.discussions === 0) {
        return { ...quiet, says: NOTHING_TO_SUMMARISE }
      }
      const many = digest.discussions === 1 ? "1 discussion" : `${digest.discussions} discussions`
      return {
        ...quiet,
        says: { tone: "quiet", text: "" },
        offer: {
          kind: "write",
          label: "Summarise these discussions",
          // The whole disclosure, before the act rather than after it. Reading
          // comment bodies is more traffic than every lookup on this page put
          // together, and the comments then go to a third party — so both are
          // said plainly, with the count that is actually true of this page.
          // "to be summarised" went; the button above it already says that.
          says:
            `Parle will read the comments of ${many} and send them to ${surroundings.provider.name}. It has not done that yet.`
        }
      }
    }
    case "Writing":
      return {
        ...quiet,
        says: {
          tone: "waiting",
          // "Going through" rather than "Reading": a `Reading` is a tab's own
          // stance in this project's vocabulary, and `render.test.ts` bans the
          // capitalised word from anything a reader sees.
          text: `Going through the comments, asking ${surroundings.provider.name}…`
        }
      }
    case "Refused":
      return {
        ...quiet,
        says: { tone: "refused", text: `No Digest. ${digest.because}` },
        offer: digest.offer === "none" ? null : digest.offer === "connect"
          ? { kind: "connect", label: "Change the Provider", says: "" }
          : { kind: "again", label: "Try again", says: "" }
      }
    case "Written":
      return {
        // A heading rather than a count. "4 findings" is a number about our
        // output; what the reader came for is what the conversation said.
        says: { tone: "found", text: "What these discussions said" },
        findings: digest.findings.map((finding) => findingView(finding, titles)),
        // Said rather than hidden. The reader paid for what did arrive and is
        // entitled to know it is not the whole of the answer.
        partial: digest.completeness === "partial",
        wrote: wroteWords(digest.origin),
        offer: { kind: "again", label: "Write it again", says: "" }
      }
  }
}

/**
 * What a fresh install owes the reader before anything is sent anywhere.
 *
 * Two sentences, and neither is optional. The first is the disclosure — where
 * the address goes, by name, before it goes — and the second is the reason this
 * panel is showing it rather than results. The button underneath is the way to
 * the whole of it.
 */
const UNDECIDED: Restraint = {
  kind: "undecided",
  says:
    "Parle sends the address of the page you are reading to Hacker News, Reddit, Bluesky, Lemmy and Lobsters. It has not started yet."
}

// ---------------------------------------------------------------------------
// The context block: the Archive, and the publisher's Standing
// ---------------------------------------------------------------------------

/**
 * The year an epoch millisecond falls in, or nothing.
 *
 * A year and not a date, and the coarseness is the claim. "First kept 2019" is
 * something the Archive can attest to; "first kept 14 March 2019 at 09:22" is a
 * precision about when a crawler happened to arrive, dressed up as a fact about
 * the page. The same reason `ageOf` rounds.
 */
const yearOf = (at: number | null): string | null => {
  if (at === null) return null
  const year = new Date(at).getUTCFullYear()
  return Number.isFinite(year) ? String(year) : null
}

/**
 * How often the kept copy changed, said as a floor when it is one.
 *
 * `clipped` means the Archive filled the window we asked for, so the count is
 * the size of our own request rather than a total — ADR 0005's rule that a
 * filled retrieval window is reported as "at least N" and never as an answer.
 * And `contentChanges` counts times the content DIFFERED from the capture before
 * it, not the number of captures, so the words say "changed" and never "kept".
 */
const changeWords = (changes: number, clipped: boolean): string => {
  if (changes === 0) return "unchanged ever since"
  const many = changes === 1 ? "once" : `${changes} times`
  return clipped ? `changed at least ${many}` : `changed ${many}`
}

/**
 * Why a place that is not a Network could not answer, in the reader's words.
 *
 * A second map beside {@link REFUSAL_WORDS} rather than a reuse of it, and the
 * reason is grammar rather than meaning: those six fragments are written to
 * complete "Reddit — …" in a two-column account, and these have to complete
 * "Parle could not ask the Internet Archive — …" in running prose. The same six
 * conditions, the same six distinctions kept apart, read aloud differently.
 */
const ASKING_WORDS: Record<RefusalReason, string> = {
  "not-signed-in": "it answers nothing without an account",
  "rate-limited": "it asked us to slow down",
  forbidden: "it refused us",
  "timed-out": "no answer came in time",
  interrupted: "the question was interrupted",
  offline: "it could not be reached"
}

/**
 * The Archive line, in whichever of its states this page is actually in.
 *
 * Five states and five different sentences, and the two that look alike on
 * screen are the two that must not be:
 *
 *   - A kept copy WITH a history says when it was first kept and how often it
 *     changed.
 *   - A kept copy with NO history says that the second question could not be
 *     asked. `record.history` is `null` for exactly one reason — the CDX half of
 *     the Lookup failed, which is routine, because it is the rate-limited half —
 *     and it means "could not ask" and never "no history". Rendering it as a
 *     silence would tell a reader that a page captured five hundred times has
 *     never changed.
 *
 * `NothingArchived` is drawn rather than dropped, because it is the one Archive
 * outcome that is evidence about the world: the Archive answered, cleanly, and
 * holds nothing. That is worth a line for the same reason a Network's Silence
 * is. What is NOT drawn is `null` — nobody asked — which is most pages.
 */
const archiveLines = (holding: Holding | null): ReadonlyArray<ContextLine> => {
  if (holding === null) return []
  switch (holding._tag) {
    case "Found": {
      const record = holding.record
      const kept = yearOf(record.snapshotAt)
      const history = record.history
      if (history === null) {
        return [{
          // Names the missing half rather than omitting it. The link still
          // works — the whole point of the two halves failing independently is
          // that a rate-limited history costs the history and not the copy.
          text: kept === null
            ? "A kept copy of this page. How often it changed — Parle could not ask."
            : `A kept copy from ${kept}. How often it changed — Parle could not ask.`,
          href: record.archivedUrl,
          links: [],
          tone: "withheld"
        }]
      }
      const first = yearOf(history.firstCaptureAt)
      const changed = changeWords(history.contentChanges, history.clipped)
      return [{
        text: first === null
          ? `A kept copy of this page, ${changed}.`
          : `First kept ${first} · ${changed}`,
        href: record.archivedUrl,
        links: [],
        tone: "found"
      }]
    }
    case "NothingArchived":
      return [{
        text: "The Internet Archive has never kept a copy of this page.",
        href: null,
        links: [],
        tone: "quiet"
      }]
    case "CouldNotAsk":
      return [{
        text: `Parle could not ask the Internet Archive — ${ASKING_WORDS[holding.reason]}.`,
        href: null,
        links: [],
        tone: "refused"
      }]
    case "Garbled":
      return [{
        text: `The Internet Archive answered, unreadably — ${holding.detail}.`,
        href: null,
        links: [],
        tone: "garbled"
      }]
  }
}

/**
 * How many citing articles the panel lists before it stops naming them.
 *
 * The list is a list of proper nouns a reader recognises, and past a handful it
 * stops being one and becomes a wall. What is not allowed is stopping quietly:
 * anything beyond this is counted in the sentence, which is the same bargain
 * every other fold in this product makes.
 */
const ARTICLES_NAMED = 4

/**
 * The Wikipedia line, in whichever of its four states this page is in.
 *
 * It sits in the Standing group rather than in one of its own, and the vocabulary
 * decision behind that is recorded in `CONTEXT.md`: which named reference works
 * cite a page is part of Standing's story about trust, and it needs no term of
 * its own because "Cited by Wikipedia" is a proper noun and plain English.
 *
 * "At least" flows from `isBounded` and from nothing else. `Cited` bounded means
 * "at least these"; `Uncited` bounded means "none of the rows we were sent",
 * which is a fact about the size of our own request and not about Wikipedia —
 * one predicate for both, so the panel and the cache cannot disagree.
 */
const citationLines = (answer: BacklinkAnswer | null): ReadonlyArray<ContextLine> => {
  if (answer === null) return []
  switch (answer._tag) {
    case "Cited": {
      const found = backlinksOf(answer)
      const named = found.slice(0, ARTICLES_NAMED)
      const links: ReadonlyArray<ContextLink> = named.map((backlink) => ({
        label: backlink.title,
        href: backlink.url
      }))
      const beyond = found.length - named.length
      const bounded = isBounded(answer)
      const head = bounded || beyond > 0
        ? `Cited by Wikipedia in at least ${found.length} ${
          found.length === 1 ? "article" : "articles"
        }:`
        : "Cited by Wikipedia:"
      return [{ text: head, href: null, links, tone: "found" }]
    }
    case "Uncited":
      return [{
        text: isBounded(answer)
          // The dangerous case, and the reason `isBounded` exists at all. An
          // empty answer from this API is not evidence that nothing exists; it
          // is evidence that the rows we were sent held nothing.
          ? "No Wikipedia article cites this page, in the ones Parle read."
          : "No Wikipedia article cites this page.",
        href: null,
        links: [],
        tone: "quiet"
      }]
    case "CouldNotAsk":
      return [{
        text: `Parle could not ask Wikipedia — ${ASKING_WORDS[answer.reason]}.`,
        href: null,
        links: [],
        tone: "refused"
      }]
    case "Garbled":
      return [{
        text: `Wikipedia answered, unreadably — ${answer.detail}.`,
        href: null,
        links: [],
        tone: "garbled"
      }]
  }
}

/**
 * What named raters say about this page's publisher, in their own words.
 *
 * `attribution` is drawn VERBATIM and is never rebuilt from `origin` and
 * `value`. ADR 0022 makes the naming structural rather than a rendering
 * convention: "This publication leans left" is an assertion Parle would have to
 * defend, and "Lean Left — per AllSides" is a checkable fact about AllSides
 * that a reader can go and argue with, which is the entire point of the product.
 * There is no constructor in `@parle/standing` that produces a claim without one,
 * and this is the function that must not undo that by paraphrasing.
 *
 * A rating found on a parent domain says so. The raters rated the publication,
 * not the subdomain, and a reader on `blogs.example.com` shown a rating filed
 * against `example.com` is owed the difference rather than a precision nobody
 * has.
 */
const standingLines = (host: string | null): ReadonlyArray<ContextLine> => {
  const standing = standingFor(host)
  if (standing === undefined) return []
  const lines: Array<ContextLine> = standing.claims.map((claim) => ({
    text: claim.attribution,
    href: null,
    links: [],
    tone: "quiet" as const
  }))
  if (standing.matchedOn === "parent-domain") {
    lines.push({
      text: `Said about ${standing.matchedHost}, not about this page.`,
      href: null,
      links: [],
      tone: "quiet"
    })
  }
  return lines
}

export const panelOf = (
  reading: Reading,
  now: number,
  surroundings: Surroundings
): Panel => {
  const base: Panel = {
    ...emptyPanel,
    heading: reading.title === "" ? reading.address : reading.title,
    address: reading.address,
    automatic: surroundings.decision === "automatic",
    index: indexNote(surroundings.index),
    stillLooking: false,
    // Standing is on EVERY frame that has a site to name, including the ones
    // where nothing was looked up. It costs no request and discloses nothing —
    // it is a lookup in a file the reader already has — so there is no gate for
    // it to pass and no reason a page Parle declines to ask about should also
    // be a page it declines to say who publishes.
    context: { archive: [], standing: standingLines(hostOf(reading.address)) }
  }

  // A reader who has not been told what this sends is shown that, and not
  // results, because there are none: nothing automatic runs in this state. It
  // beats every other restraint — an excluded page and a fresh install both
  // look up nothing, and the reason the reader needs is the second one.
  //
  // It does NOT short-circuit the derivation, so the account of every Place is
  // still built and still rendered underneath. An install that asks nothing and
  // shows a blank panel is indistinguishable from one that is broken, and the
  // claim "nothing was asked" is only checkable if the list is there.
  const untold = surroundings.decision === "undecided"

  if (reading.standing._tag === "Unopened") {
    return untold ? { ...base, restraint: UNDECIDED } : { ...base, stillLooking: true }
  }
  if (reading.standing._tag === "Excluded") {
    return {
      ...base,
      restraint: untold
        ? UNDECIDED
        : { kind: "not-a-web-page", says: reading.standing.because }
    }
  }

  const knowledge = reading.standing.knowledge
  const discussions = new Map(knowledge.discussions.map((d) => [discussionKey(d.id), d]))
  const observations = new Map(
    knowledge.observations.map((o) => [discussionKey(o.discussion), o])
  )

  // A Discussion can be claimed by several Places at several tiers. It appears
  // once, at its strongest — never in two groups, and never demoted because a
  // weaker claim happened to arrive second.
  const strongest = new Map<string, Tier>()
  for (const consultation of knowledge.coverage.consultations) {
    if (consultation._tag !== "Answered") continue
    for (const mention of consultation.mentions) {
      const key = discussionKey(mention.discussion)
      const tier = tierOf(mention)
      const standing = strongest.get(key)
      if (standing === undefined || STRENGTH[tier] > STRENGTH[standing]) {
        strongest.set(key, tier)
      }
    }
  }

  const opened = new Map(knowledge.opened)
  const grouped: Record<Tier, Array<Row>> = { linked: [], passing: [] }
  for (const [key, tier] of strongest) {
    const discussion = discussions.get(key)
    if (discussion === undefined) continue
    const observed: Observation | undefined = observations.get(key)
    grouped[tier].push({
      key,
      network: discussion.id.network,
      networkName: networkName(discussion.id.network),
      place: discussion.venue,
      // An untitled row is a Network that answered without a title — an
      // old.reddit search row with the anchor text suppressed. The permalink
      // is what we do know, and it is better than a blank line.
      title: discussion.title === "" ? permalinkOf(discussion.id) : discussion.title,
      // `null` is "the Network did not say", which is not the same as zero and
      // must not render as a score that fell to nothing.
      score: observed?.score ?? 0,
      commentCount: observed?.comments ?? 0,
      age: discussion.postedAt === null ? "" : ageOf(discussion.postedAt, now),
      permalink: permalinkOf(discussion.id),
      tier,
      alsoSubmitted: 0,
      comments: commentsOf(opened.get(key), now)
    })
  }

  const loudest = (row: Row): number => -(row.score * 1000 + row.commentCount)
  for (const tier of ["linked", "passing"] as const) {
    grouped[tier].sort((a, b) => loudest(a) - loudest(b))
  }

  // Is this address a site's entrance rather than a document on it?
  //
  // Judged from the Linked Mentions and nothing else, because they are the only
  // tier that means "a conversation submitted THIS address". A Passing Mention
  // is somebody quoting a link, which is not a submission, so it is not
  // evidence about what kind of page this is.
  //
  // Re-derived on every frame rather than read from anywhere. Its inputs are
  // titles and timestamps, both already in the answer, so there is no request
  // to save and no staleness window to get wrong — which is also why the
  // remembered judgement in `FrontDoorMemory` can be overwritten freely.
  const submissions = grouped.linked.flatMap((row) => {
    const discussion = discussions.get(row.key)
    return discussion === undefined
      ? []
      : [{ title: discussion.title, postedAt: discussion.postedAt }]
  })
  // Judged on every address believed to point at this Subject, not only the
  // elected one. `en.wikipedia.org/` redirects to `/wiki/Main_Page`, and on the
  // elected URL alone that is a deep path the rule declines to look at — so the
  // encyclopedia's front door drew eleven rows including "Wikipedia Is Down?".
  // The address the reader's browser started from is evidence ADR 0015 already
  // admits, and `Reading.traversed` is where it arrives.
  const judgedOn = [reading.standing.subject as string, ...reading.traversed]
  const verdict = surroundings.everyDiscussion
    ? FrontDoor.document
    : FrontDoor.judge(judgedOn, submissions)

  const fresh = (row: Row): boolean => {
    const discussion = discussions.get(row.key)
    return discussion !== undefined && discussion.postedAt !== null &&
      now - discussion.postedAt <= FrontDoor.HORIZON_MS
  }

  // The domain restriction, and the whole answer to "I don't want to miss a
  // page the moment it is discussed": a Discussion inside the horizon is drawn
  // normally, because the verdict is never consulted for it. Nothing is
  // mitigating that risk — it is outside the rule.
  const showable = verdict._tag === "FrontDoor" ? grouped.linked.filter(fresh) : grouped.linked
  const stale = verdict._tag === "FrontDoor" ? grouped.linked.filter((r) => !fresh(r)) : []

  // Only the Linked tier, and only after sorting — see `repeatsFolded`. Run
  // over each half separately so a shown row never carries a count of rows the
  // reader is about to be offered separately.
  const linked = repeatsFolded(showable)
  const hidden = repeatsFolded(stale)

  const site = hostOf(reading.address) ?? "this site"
  const folded: Folded | null = verdict._tag === "FrontDoor" && hidden.length > 0
    ? {
      says: foldWords(site, verdict.because, hidden.length, linked.length > 0),
      label: hidden.length === 1 ? "Show it" : "Show them",
      rows: hidden
    }
    : null

  const consultations = knowledge.coverage.consultations
  const accounts = consultations.map((consultation) => accountOf(consultation, surroundings))
  const settled = isSettled(knowledge.coverage)
  // Counted after folding, because it is what the reader will see and what the
  // toolbar's own count has to agree with.
  const found = linked.length + grouped.passing.length

  // Who could have known and actually said something. A Silence is that; so is
  // an Answered that happened to carry nothing we could draw. A Refusal and a
  // Withholding are not, and this is the whole distinction between "nobody has
  // discussed this" and "we never found out".
  //
  // **Only Networks count.** The Recall Place is the reader's own machine, and
  // `Enquiry` never withholds it and never lets it refuse — it always answers,
  // and on a worker that has looked nothing up it always answers with nothing.
  // Counting that silence as somebody having answered made a page where every
  // Network refused read as "Nobody has discussed this page", which is the one
  // lie this derivation exists to prevent. A device with no record is evidence
  // about the device.
  const answeredBy: Array<string> = []
  for (const consultation of consultations) {
    if (consultation.place._tag !== "Network") continue
    if (consultation._tag !== "Silence" && consultation._tag !== "Answered") continue
    const name = networkName(consultation.place.network)
    if (!answeredBy.includes(name)) answeredBy.push(name)
  }

  const heldBack = heldBackFor(consultations)

  return {
    ...base,
    restraint: untold
      ? UNDECIDED
      : heldBack === null
      ? null
      : restraintFor(heldBack, reading, surroundings, consultations),
    linked,
    passing: grouped.passing,
    folded,
    accounts,
    stillLooking: !settled,
    waitingOn: consultations
      .filter((c) => c._tag === "Pending" || c._tag === "Asking")
      .map((c) => placeName(c.place)),
    // `folded === null` on both, and it is not belt-and-braces. A page with
    // eight folded Discussions has been discussed; saying "Nobody has discussed
    // this page" over the line offering to show them would be the exact lie
    // this derivation exists to prevent, arriving through the one path that
    // takes rows OUT of the count.
    foundNothing: settled && found === 0 && folded === null && answeredBy.length > 0,
    couldNotAsk: settled && found === 0 && folded === null && answeredBy.length === 0,
    answeredBy,
    windowed: windowedNote(knowledge.coverage),
    // The two asked halves, joined onto the free one already in `base`. The
    // Wikipedia line sits with Standing rather than with the Archive because it
    // is about who vouches for this page, not about who kept a copy of it.
    context: {
      archive: archiveLines(knowledge.archive),
      standing: [...base.context.standing, ...citationLines(knowledge.backlinks)]
    },
    digest: digestView(
      reading,
      surroundings,
      settled,
      new Map([...discussions].map(([key, discussion]) => [key, discussion.title]))
    )
  }
}
