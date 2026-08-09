/**
 * What is, and is not, a reason to believe two addresses are one Subject.
 *
 * A Mention keys on an alias set that can grow, so learning later that two
 * addresses are one page must *repair* rows already stored — see
 * {@link Recollection.merge}. The counterpart to that power is being extremely
 * clear about what licenses it, because a merge is destructive in a way a missing
 * row is not: two Subjects wrongly merged cannot be told apart afterwards.
 *
 * ADR 0015 draws the line at evidence **we observed**: a redirect the reader's own
 * browser traversed, a Network's own submitted URL, or our own canonicalization
 * rules. Never a page's self-declared `rel=canonical`. A page asserting its own
 * identity is not evidence — it is a claim by the party with the most to gain, and
 * honouring it would let a publisher merge or split Subjects at will. The concrete
 * abuse is not hypothetical: point every article's `rel=canonical` at the homepage
 * and one 640-point thread's Discussion attaches to the entire site.
 *
 * `@parle/domain`'s {@link AliasEvidence} already encodes the *outcome* of that
 * rule — it has three cases and none of them is a self-declaration — but a type
 * that omits a case cannot refuse it, it can only fail to mention it. So the
 * refusal is written down here as a {@link Claim} that includes `SelfDeclared`
 * and an {@link observed} that cannot turn it into evidence. The rejection becomes
 * a thing with a name, a test, and a reason attached, rather than an absence
 * someone re-adds in good faith.
 *
 * This belongs in `@parle/domain` beside `AliasEvidence` and is not there yet, so
 * it lives here in the meantime. Nothing else in this package depends on where it
 * lives.
 */
import * as Option from "effect/Option"
import { AliasEvidence, RulesVersion } from "@parle/domain/Subject"

/**
 * Something offered as a reason to believe two addresses point at one Subject.
 *
 * A Claim is not evidence. Three of these four cases become evidence; the fourth
 * is here precisely so that it can be handed to {@link observed} and refused.
 */
export type Claim =
  /** Our own canonicalization rules produced the same address from both. */
  | { readonly _tag: "Canonicalized"; readonly rulesVersion: number }
  /** The reader's own browser traversed a redirect from one to the other. */
  | { readonly _tag: "Redirected"; readonly from: string }
  /** A Network's own submitted URL for a Discussion resolved to the other. */
  | { readonly _tag: "Submitted"; readonly network: string }
  /**
   * The page said so itself — `rel=canonical`, `og:url`, a JSON-LD `@id`.
   *
   * Never sufficient, alone or in company. It is carried rather than dropped so
   * that the refusal is visible at the call site instead of happening in a
   * parser nobody reads.
   */
  | { readonly _tag: "SelfDeclared"; readonly declared: string }

/**
 * The evidence in a Claim, if there is any.
 *
 * `Option.none` for a self-declaration, and that is the whole point of the
 * function: `Recollection.merge` takes `AliasEvidence`, so a caller holding only a
 * `rel=canonical` has nothing to pass it and no way to manufacture one.
 */
export const observed = (claim: Claim): Option.Option<AliasEvidence> => {
  switch (claim._tag) {
    case "Canonicalized":
      return Option.some(
        AliasEvidence.cases.Canonicalized.make({ rulesVersion: RulesVersion.make(claim.rulesVersion) })
      )
    case "Redirected":
      return Option.some(AliasEvidence.cases.Redirected.make({ from: claim.from }))
    case "Submitted":
      return Option.some(AliasEvidence.cases.Submitted.make({ network: claim.network }))
    case "SelfDeclared":
      // A page asserting its own identity. Not evidence, at any strength, and
      // not upgraded by arriving alongside evidence either — a caller with a
      // redirect in hand passes the redirect.
      return Option.none()
  }
}

/** True when a Claim licenses a merge. `observed` is what a caller actually needs. */
export const licensesMerge = (claim: Claim): boolean => Option.isSome(observed(claim))
