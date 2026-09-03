/**
 * Everything one Enquiry has asked and learned, as a single value.
 *
 * The Enquiry publishes whole Knowledge values rather than events, and every
 * intermediate one is renderable. That is the property that makes a panel
 * opened three seconds late correct: it has no prefix of events to have missed,
 * because there were no events. It also removes the tuning constant — buffer
 * size, replay window — that silently truncates a late subscriber and produces
 * a panel that is wrong in a way nothing logs.
 *
 * Coverage is seeded with every Place already present as `Pending`, before a
 * single request is made. An absent Place and a Place that answered with
 * nothing are different facts and the panel says different things about them,
 * so Coverage is never allowed to be partially populated — there is no moment
 * at which it can fail to mention somewhere we are going to turn.
 *
 * Folding a Reply *replaces* the Consultation for its Place rather than
 * appending. Two Consultations for one Place is not a state this system has:
 * `Pending → Asking → (Answered | Silence | Refusal | Garble | Withholding)` is
 * one cell changing, and appending would let the panel render a Place as both
 * still looking and already refused.
 */
import * as Schema from "effect/Schema"
import { Holding } from "@parle/archive/Holding"
import { BacklinkAnswer } from "@parle/backlinks/Backlink"
import { Consultation, Coverage, Place } from "@parle/domain/Coverage"
import { Citation, DigestOrigin } from "@parle/domain/Digest"
import { discussionKey } from "@parle/domain/Network"
import type { SubjectUrl } from "@parle/domain/Subject"
import { Discussion } from "@parle/networks/Discussion"
import { Observation } from "@parle/networks/Observation"
import type { Rows } from "../gathered/Gathered.ts"

/**
 * A Finding as a surface receives it.
 *
 * A Digest is admitted — decoded against its Brief — in the background, where
 * the Brief exists. What crosses to the panel is what survived that, so this
 * shape carries no claim of its own about what it was written from: the panel
 * cannot re-check the invariant and must not appear to.
 *
 * `citations` is a `NonEmptyArray` for the one thing this shape CAN carry.
 * ADR 0006's rule is that a Finding always cites, `@parle/domain`'s `Finding`
 * spells that as `NonEmptyArray` — and this said `Array`, so the one hop between
 * the invariant and the screen was the hop that did not hold it. `render.ts`
 * draws `finding.statement` and then loops over the sources, so a Finding with
 * none renders as an attributed sentence with nothing under it: an uncited
 * claim, arrived at by producing less rather than more, which is how the last
 * two got in.
 */
export const Attributed = Schema.Struct({
  statement: Schema.String,
  contested: Schema.Boolean,
  citations: Schema.NonEmptyArray(Citation)
})
export type Attributed = typeof Attributed.Type

/**
 * What the reader can do about a Digest that is not there.
 *
 * Carried rather than derived from the words, because the right offer is a
 * function of WHY it failed and the words are the only other thing that knows.
 * A rate limit wants "try again", a rejected key wants the settings page, and a
 * model that answered unusably wants neither dressed up as a fix — offering the
 * wrong one is a button that does nothing at the moment the reader is already
 * disappointed.
 */
export const DigestOffer = Schema.Literals(["again", "connect", "none"])
export type DigestOffer = typeof DigestOffer.Type

/**
 * Where the Digest has got to. Every case is a state, never an error.
 *
 * There is deliberately no `NoProvider` case here, and its absence is the
 * design. Whether a Provider is connected is a fact about the INSTALLATION, not
 * about this Subject: it is the same on every tab, it changes when the reader
 * edits their settings rather than when a Lookup answers, and holding a copy of
 * it per Enquiry is how a panel ends up saying "No Provider connected" about a
 * key the settings page is already showing. It travels on `Surroundings`, with
 * the reader's other install-wide decisions, and `panelOf` marries the two.
 *
 * {@link DigestStanding.Ready} is the state this union used to be missing, and
 * that absence was a design decision by accident. Building a Brief means
 * reading the comment BODIES of several Discussions — far more traffic than the
 * Lookups that found them — so it has to be something the reader asks for,
 * which means there has to be a state that says "this much material exists and
 * none of it has been fetched". Without it the only options were to fetch on
 * every page load or never to fetch at all.
 */
export const DigestStanding = Schema.TaggedUnion({
  /**
   * Nothing has been asked for, and this is how much there would be to read.
   *
   * `discussions` is a count of Linked Mentions, capped at what a Brief would
   * actually take, so the panel can tell the reader what asking costs before
   * they agree to it rather than afterwards. Zero is a real and common value:
   * a page nobody has linked to has nothing to summarise.
   */
  Ready: { discussions: Schema.Number },
  Writing: {},
  Written: {
    origin: DigestOrigin,
    completeness: Schema.Literals(["complete", "partial"]),
    findings: Schema.Array(Attributed)
  },
  /** The Provider could not answer. A fact about the attempt, never about the page. */
  Refused: { because: Schema.String, offer: DigestOffer }
})
export type DigestStanding = typeof DigestStanding.Type

/**
 * Whether a Digest has been asked for yet.
 *
 * `Ready` is recomputed as Discussions arrive; the other three are consequences
 * of the reader's own act and must never be overwritten by one. A late Lookup
 * landing after they asked would otherwise take a finished Digest off the
 * screen, and a second click would pay for the same Digest twice.
 */
export const unasked = (standing: DigestStanding): boolean => standing._tag === "Ready"

/**
 * Whether a Digest is being written right now.
 *
 * The one state a fresh ask must not start on top of. Everything else may be
 * asked again — a rate limit clears, a rejected key is replaced, and a Digest
 * of a conversation that has grown is worth rewriting — so this is deliberately
 * narrower than {@link unasked}. Using that one here would make "Try again" and
 * "Write it again" buttons that do nothing, which is the worst kind: the reader
 * concludes the Provider failed silently.
 */
export const writing = (standing: DigestStanding): boolean => standing._tag === "Writing"

/**
 * What one Discussion is saying, once a reader opened it.
 *
 * Keyed by `discussionKey` so a Reading survives the Discussion list being
 * rebuilt around it. `Unreadable` is kept rather than dropped for the reason
 * every other failure in this codebase is kept: a row that silently goes back
 * to closed tells the reader their click did nothing.
 */
export const Opened = Schema.TaggedUnion({
  Reading: {},
  Unreadable: {},
  Read: {
    comments: Schema.Array(Schema.Struct({
      id: Schema.String,
      parentId: Schema.NullOr(Schema.String),
      depth: Schema.Number,
      author: Schema.String,
      text: Schema.String,
      postedAt: Schema.NullOr(Schema.Number)
    })),
    beyond: Schema.Number
  }
})
export type Opened = typeof Opened.Type

export const Knowledge = Schema.Struct({
  coverage: Coverage,
  discussions: Schema.Array(Discussion),
  observations: Schema.Array(Observation),
  digest: DigestStanding,
  /** Discussions the reader has opened, by `discussionKey`. */
  opened: Schema.Array(Schema.Tuple([Schema.String, Opened])),
  /**
   * What the Internet Archive said about this Subject, once anybody asked.
   *
   * `null` is **not asked yet**, and it is the only thing `null` means here.
   * Every way the question can END is a case of `Holding` — including
   * `CouldNotAsk`, which is why a failed Archive Lookup is a non-null value
   * that renders its own reason rather than an absence the panel has to guess
   * about. That distinction is the whole of ADR 0005 applied to a second kind
   * of place: "nothing kept" and "we could not find out" are opposite facts.
   *
   * It lives on Knowledge rather than on a Reading because it is a fact about
   * the SUBJECT — two tabs on one page share it, and a back button inside the
   * idle window rejoins the answer already paid for rather than asking the
   * Archive again from the reader's own address.
   *
   * Note the second nullable inside it: `Found.record.history` is null when the
   * CDX half of the Lookup could not be asked, which is routine, and means
   * "could not ask" and never "no history" — once that half has settled.
   * `historyPending` is the wait before that, and is not a miss. See
   * `@parle/archive`'s `Holding.ts`.
   */
  archive: Schema.NullOr(Holding),
  /**
   * Which named reference works cite this Subject, once anybody asked.
   *
   * `null` is "not asked yet", exactly as above. `Cited` is "at least these" —
   * `isBounded` is the one predicate anything rendering or caching this may ask,
   * because a bounded `Uncited` is a fact about the size of our own request and
   * not about Wikipedia.
   */
  backlinks: Schema.NullOr(BacklinkAnswer)
})
export type Knowledge = typeof Knowledge.Type

/**
 * Which emission to keep while one Archive lookup moves from transient to done.
 *
 * A kept copy with history beats a kept copy without, and a kept copy beats a
 * CouldNotAsk. This does not authorize another lookup: each Enquiry asks once.
 * It only orders the immediate first-paint callback and the terminal result of
 * that same lookup, including overlapping surface updates.
 */
export const preferArchive = (held: Holding | null, next: Holding): Holding => {
  if (held === null) return next
  if (held._tag === "Found" && next._tag !== "Found") return held
  if (held._tag === "NothingArchived" && next._tag === "CouldNotAsk") return held
  if (held._tag === "Found" && next._tag === "Found") {
    return held.record.history !== null ? held : next
  }
  return next
}

const samePlace = (a: Place, b: Place): boolean => {
  if (a._tag !== b._tag) return false
  if (a._tag === "Recall" || b._tag === "Recall") return true
  return a.network === b.network
}

const placeOf = (consultation: Consultation): Place => consultation.place

/** A Knowledge with every Place accounted for and nothing asked yet. */
export const begin = (
  subject: SubjectUrl,
  places: ReadonlyArray<Place>
): Knowledge => ({
  coverage: Coverage.make({
    subject,
    consultations: places.map((place) => Consultation.cases.Pending.make({ place }))
  }),
  discussions: [],
  observations: [],
  digest: DigestStanding.cases.Ready.make({ discussions: 0 }),
  opened: [],
  // Not asked. Both are LAZY — nothing here fires on navigation, only when the
  // reader opens the panel on this page (the one exception is the reader's own
  // auto-open-the-archived-copy setting, which is them asking for exactly this
  // at exactly that moment).
  archive: null,
  backlinks: null
})

/**
 * Record what opening one Discussion turned up, leaving every other alone.
 *
 * Replaces by key rather than appending: a `Reading` becomes a `Read` in place,
 * so the row does not have to reason about which of two entries is current.
 */
export const openedWith = (
  knowledge: Knowledge,
  key: string,
  opened: Opened
): Knowledge => ({
  ...knowledge,
  opened: [...knowledge.opened.filter(([held]) => held !== key), [key, opened] as const]
})

/** Move one Place to a new Consultation, leaving every other Place alone. */
export const mark = (knowledge: Knowledge, consultation: Consultation): Knowledge => {
  const place = placeOf(consultation)
  const consultations = knowledge.coverage.consultations.map((standing) =>
    samePlace(placeOf(standing), place) ? consultation : standing
  )
  return {
    ...knowledge,
    coverage: Coverage.make({ subject: knowledge.coverage.subject, consultations })
  }
}

/**
 * Take in what one Place said, and the rows its Mentions can be drawn as.
 *
 * Discussions are merged by identity — the (Network, native id) PAIR, via
 * `discussionKey` — never by the native id alone. Reddit's base-36 ids and
 * Hacker News' decimal ids share a namespace by accident, and a bare-string key
 * merges two unrelated conversations into one row.
 *
 * The rows arrive alongside the Consultation rather than inside it because a
 * `Consultation` carries Mentions and a Mention carries identity and evidence —
 * deliberately, since that is all Coverage needs to be true. Where the title
 * comes from is the caller's business; that it arrives in the same fold is what
 * stops a row appearing with no Consultation accounting for it.
 */
export const fold = (
  knowledge: Knowledge,
  consultation: Consultation,
  rows: Rows
): Knowledge => {
  const discussions = new Map(knowledge.discussions.map((d) => [discussionKey(d.id), d]))
  for (const discussion of rows.discussions) {
    discussions.set(discussionKey(discussion.id), discussion)
  }

  const observations = new Map(
    knowledge.observations.map((o) => [discussionKey(o.discussion), o])
  )
  for (const observation of rows.observations) {
    const key = discussionKey(observation.discussion)
    const standing = observations.get(key)
    // Superseded by receive time, never corrected in place.
    if (standing === undefined || standing.receivedAt <= observation.receivedAt) {
      observations.set(key, observation)
    }
  }

  return {
    ...mark(knowledge, consultation),
    discussions: [...discussions.values()],
    observations: [...observations.values()]
  }
}
