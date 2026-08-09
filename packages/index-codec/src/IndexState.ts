/**
 * What the client is currently holding — which is a different question from
 * what the index says about a Subject.
 *
 * The stress tests turned up a vocabulary failure worth a type: **"index stale"
 * and "index absent" are different states and need different copy.** A reader
 * told "we have no index" when we are in fact serving last month's is being
 * told something false; a reader told "the index is a bit old" when we have
 * never successfully fetched one is being told something worse, because it
 * implies a coverage we do not have. Both are also different from "we fetched
 * one and refused it", which is the canonicalizer-mismatch case and is the only
 * one that indicates a bug rather than a network.
 *
 * Four states, each with its own copy, and only two of them can answer a probe.
 */
import * as Schema from "effect/Schema"

/**
 * Why an offered artifact was refused.
 *
 * Every one of these leaves the client strictly no worse off than having no
 * index: refusing is always safe, because the index may only suspect. Refusing
 * is therefore the default on anything unrecognised, which is what makes
 * forward skew — a manifest from a newer build — a non-event.
 */
export const Rejection = Schema.Literals([
  /**
   * The manifest was built from a different version of the canonicalization
   * rules than this client runs. THE loud failure: probing anyway would produce
   * silent false negatives on every page whose canonical form differs between
   * the two rule versions, and a silent false negative is invisible to
   * everyone. ADR 0005's whole argument is that this must never happen quietly.
   */
  "canonicalizer-mismatch",
  /** A manifest schema version this build does not know. */
  "schema-version-unsupported",
  /** A filter kind this build cannot read — a future family, not a corruption. */
  "filter-kind-unsupported",
  /** A fingerprint width outside 8, 16 and 32. */
  "fingerprint-width-unsupported",
  /** The manifest published no filter this build can use. Normal while v1 is Hacker News only. */
  "no-filter-published",
  /** The bytes did not hash to the digest the manifest pinned them at. */
  "sha256-mismatch",
  /** The bytes were not a filter: truncated, an error page, a half-written cache entry. */
  "bytes-unreadable",
  /** The manifest did not decode at all. */
  "manifest-unreadable"
])
export type Rejection = typeof Rejection.Type

/**
 * The state of the client's own copy of the Discussion Index.
 *
 * `Serving` and `Stale` both answer probes — a month-old filter is still a
 * perfectly good filter, it merely lacks the last month's URLs, and lacking
 * them costs a Lookup we would have made anyway. `Absent` and `Refused` answer
 * nothing, and both must be rendered as "we have no index", differently
 * worded.
 */
export const IndexState = Schema.TaggedUnion({
  /** Nothing has ever been offered. The state a fresh install is in, and a normal one. */
  Absent: {},
  /**
   * Something was offered and refused, and there was no earlier copy to fall
   * back to. Behaves exactly like `Absent`; carries the reason because this is
   * the state a misconfigured or hostile index origin produces, and someone has
   * to be able to see which.
   */
  Refused: { rejection: Rejection },
  /** Holding the artifact the manifest currently advertises. */
  Serving: {
    generation: Schema.String,
    canonicalizerVersion: Schema.String,
    keyCount: Schema.Number,
    addendumKeyCount: Schema.Number
  },
  /**
   * Holding an earlier artifact because a newer one could not be adopted.
   *
   * The fallback ladder's middle rung, and the reason it exists: a corrupt
   * download must not cost the reader the good index they already had.
   */
  Stale: {
    generation: Schema.String,
    canonicalizerVersion: Schema.String,
    keyCount: Schema.Number,
    addendumKeyCount: Schema.Number,
    rejection: Rejection
  }
})
export type IndexState = typeof IndexState.Type

/** True while the client holds something it may probe. Internal plumbing, not a decision. */
export const isServingSomething = (state: IndexState): boolean =>
  state._tag === "Serving" || state._tag === "Stale"
