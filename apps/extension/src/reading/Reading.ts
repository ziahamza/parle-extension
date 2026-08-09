/**
 * One reader's encounter with one Subject, and the whole of what a surface draws.
 *
 * A Reading is the reader's *stance*: which address settled, what caused it,
 * this reader's own horizon, and — as it accrues — the Knowledge of the Subject
 * that address elected. Knowledge is Subject-keyed and shared between every tab
 * on the same page; the stance is not, and keeping them in one value with two
 * lifetimes is what stops one tab's arrival evidence from leaking into another
 * tab's panel. Two tabs on one URL, one arrived from a Hacker News item and one
 * from a chat message, must not both be told "you arrived here from HN item
 * 39285714" — and it is the *strong* tier that would be lying.
 *
 * `standing` has three cases and no fourth. In particular "excluded" is a case
 * with the reason attached rather than an absence, because the panel has to be
 * able to say *why* it is not looking; ADR 0011 makes every degraded capability
 * a state the panel renders, not an error it may throw.
 */
import * as Schema from "effect/Schema"
import { WithholdingReason } from "@parle/domain/Coverage"
import { Arrival, SubjectUrl } from "@parle/domain/Subject"
import { Knowledge } from "../enquiry/Knowledge.ts"

export const Standing = Schema.TaggedUnion({
  /** No address has settled in this frame yet. */
  Unopened: {},
  /** We will not look this page up, and this is what the reader is owed. */
  Excluded: { reason: WithholdingReason, because: Schema.String },
  /** An Enquiry is open, and this is everything it has learned so far. */
  Enquiring: { subject: SubjectUrl, knowledge: Knowledge }
})
export type Standing = typeof Standing.Type

export const Reading = Schema.Struct({
  /** The address as the browser has it — never the key. */
  address: Schema.String,
  title: Schema.String,
  arrival: Arrival,
  standing: Standing,
  /**
   * Which rule of the Exclusion List covers this address, in the reader's own
   * words, or `null` when none does.
   *
   * It sits on the Reading rather than travelling with the Withholding because
   * `Coverage`'s vocabulary has one literal — `excluded` — and no room for the
   * rule that produced it, and `@parle/domain` is closed. Recomputing it here,
   * once per settled address, is what lets the panel say "chase.com is on the
   * built-in list, under banking" instead of "excluded": ADR 0005's objection
   * is that a silent false negative is one nobody can complain about, and a
   * reason nobody can read is the same objection one step later.
   */
  excludedBecause: Schema.NullOr(Schema.String)
})
export type Reading = typeof Reading.Type

export const unopened: Reading = {
  address: "",
  title: "",
  arrival: Arrival.cases.Elsewhere.make({}),
  standing: Standing.cases.Unopened.make({}),
  excludedBecause: null
}
