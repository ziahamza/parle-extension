/**
 * What the Discussion Index is allowed to say about a Subject.
 *
 * The glossary is explicit and the ADRs are unanimous: the index "can suspect
 * and it can be silent; it can never say a Subject has none". ADR 0005 spells
 * out the consequence — a prefilter that gates produces silent false negatives,
 * and a Lookup that never fires is invisible to the reader, who therefore
 * cannot complain about it. The index may only make a Lookup faster, or make us
 * distrust an unexpected Silence.
 *
 * So the answer is a three-case tagged union and **not a boolean**, and nothing
 * in this package returns a decision:
 *
 * - `Possible` — some filter we hold suspects this Subject. Only ever a
 *   suspicion: at an 8-bit fingerprint roughly one probe in 264 is wrong in
 *   this direction, and being wrong in this direction costs a Lookup we were
 *   going to make anyway.
 * - `NotListed` — every filter we hold declined it. A statement about the
 *   INDEX, not about the world. It licenses exactly one inference: an
 *   unexpected Silence from a Network is less surprising than it looked.
 * - `NoIndex` — we hold nothing usable. Indistinguishable, in what it licenses,
 *   from `NotListed`; distinguished because the reader-facing copy differs and
 *   because a client that cannot tell them apart cannot report its own state.
 *
 * There is deliberately no `definitelyHasDiscussion`, no `shouldLookUp`, and no
 * `boolean` anywhere on this surface. Promoting the index from optimisation to
 * gate — which ADR 0005 permits only once coverage is exhaustive across every
 * Network — means adding a fourth constructor, which breaks every match site in
 * the codebase. That friction is the point.
 */
import { Network } from "@parle/domain/Network"
import * as Schema from "effect/Schema"

/**
 * What the index has to say.
 *
 * `Possible` carries which Networks' filters suspected the Subject, because the
 * artifact set is per-Network (a Reddit filter can be added later without a
 * format change) and "Hacker News suspects this" is worth more to a caller
 * ordering its Lookups than a bare yes. Nothing may branch on it as
 * permission — it is ordering information, not authorisation.
 */
export const Hint = Schema.TaggedUnion({
  Possible: { networks: Schema.Array(Network) },
  NotListed: {},
  NoIndex: {}
})
export type Hint = typeof Hint.Type

export const possible = (networks: ReadonlyArray<Network>): Hint =>
  Hint.cases.Possible.make({ networks: [...networks] })

export const notListed: Hint = Hint.cases.NotListed.make({})

export const noIndex: Hint = Hint.cases.NoIndex.make({})
