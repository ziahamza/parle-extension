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

export const Knowledge = Schema.Struct({
  coverage: Coverage,
  discussions: Schema.Array(Discussion),
  observations: Schema.Array(Observation),
  digest: DigestStanding
})
export type Knowledge = typeof Knowledge.Type

const samePlace = (a: Place, b: Place): boolean => {
  if (a._tag !== b._tag) return false
  if (a._tag === "Recall" || b._tag === "Recall") return true
  return a.network === b.network && a.question === b.question
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
  digest: DigestStanding.cases.Ready.make({ discussions: 0 })
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
