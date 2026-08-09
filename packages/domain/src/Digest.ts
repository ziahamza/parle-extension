/**
 * The Digest, and the invariant that makes ADR 0006 real rather than decorative.
 *
 * A Digest may report a claim as contested. That is the only judgement it makes,
 * and it is always someone else's — so every Finding must cite a Discussion that
 * actually exists in the Brief it was written from.
 *
 * The obvious way to enforce that is a check over the payload's own list of
 * sources. It does not work: a Provider that invents a source AND a Citation
 * naming it satisfies the check by hallucinating slightly more. That was
 * demonstrated — a fabricated Digest passed, and the failure surfaced exactly
 * where trust matters most, as a contested flag against a named paper with a
 * dead link and an invented quote.
 *
 * So the Brief is supplied OUT OF BAND, as a service the decoder requires.
 * `Schema.decodeUnknownEffect(Digest)` types as
 * `Effect<Digest, SchemaError, Brief>` — you cannot decode model output without
 * producing the material it was supposed to be reading. The invariant is not a
 * convention anyone can forget; it is the type of the only door in.
 *
 * Two corollaries, both load-bearing:
 *   - Model output is always DECODED, never `.make`d, and `disableChecks` is
 *     banned repo-wide.
 *   - The invariant lives on the Finding, not the Digest root, so a Provider
 *     that dies mid-stream yields a partial Digest of good Findings rather than
 *     dropping a complete, correctly-cited one.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import { DiscussionId, discussionKey } from "./Network.ts"

/** A pointer from a Finding to the Discussion evidencing it. */
export class Citation extends Schema.Opaque<Citation, { readonly _brand: "Citation" }>()(
  Schema.Struct({
    discussion: DiscussionId,
    /** Which comment within the Discussion, when the Provider identified one. */
    comment: Schema.optionalKey(Schema.String)
  })
) {}

/**
 * The exact material a Digest is written from.
 *
 * Supplied to the decoder as a service. It answers only "is this Discussion
 * something you were actually given?" — it never hands out content, so a
 * Provider cannot mine it.
 */
export class Brief extends Context.Service<Brief, {
  readonly contains: (id: DiscussionId) => boolean
  readonly subject: string
}>()("parle/digest/Brief") {}

/** The shape a Provider is asked to produce, before it has been held to account. */
const FindingShape = Schema.Struct({
  statement: Schema.String,
  /** Reported as disputed by the cited Discussion. Never our own judgement. */
  contested: Schema.Boolean,
  citations: Schema.NonEmptyArray(Citation)
})

/**
 * One attributed statement, verified against the Brief at decode time.
 *
 * Decoding this requires `Brief`, so there is no way to obtain a Finding
 * without it.
 */
export const Finding = FindingShape.pipe(
  Schema.decode({
    decode: SchemaGetter.checkEffect((finding: typeof FindingShape.Type) =>
      Effect.gen(function*() {
        const brief = yield* Brief
        const fabricated = finding.citations
          .filter((c) => !brief.contains(c.discussion))
          .map((c) => discussionKey(c.discussion))

        if (fabricated.length === 0) return undefined
        return {
          path: ["citations"],
          issue:
            `cites ${fabricated.join(", ")}, which ${fabricated.length === 1 ? "is" : "are"} not in the Brief`
        }
      })
    ),
    encode: SchemaGetter.passthrough()
  })
)
export type Finding = typeof Finding.Type

/** Whether a Digest is everything the Provider had to say, or all we could keep. */
export const Completeness = Schema.Literals(["complete", "partial"])
export type Completeness = typeof Completeness.Type

/** Where a Digest was written. Not two kinds of Digest — one kind, two writers. */
export const DigestOrigin = Schema.TaggedUnion({
  /** By us, for a Subject over the popularity threshold, served to everyone. */
  Shared: { builtAt: Schema.String },
  /** By the reader's own Provider, on their machine, never leaving it. */
  Local: { providerId: Schema.String, model: Schema.String }
})
export type DigestOrigin = typeof DigestOrigin.Type

/**
 * A set of Findings written from a Brief and accountable to it.
 *
 * Note `findings` is a NonEmptyArray: an empty Digest would otherwise decode as
 * a structurally perfect, fully "cited" document that asserts nothing, which is
 * indistinguishable from success and renders as an empty panel.
 */
export const Digest = Schema.Struct({
  subject: Schema.String,
  origin: DigestOrigin,
  completeness: Completeness,
  findings: Schema.NonEmptyArray(Finding)
})
export type Digest = typeof Digest.Type

/**
 * The only door in, for Provider output and Shared Digest bytes alike.
 *
 * Applying this to our own backend's bytes is not distrust of our own code: the
 * two tracks release independently, the backend origin is user-configurable, and
 * the licence invites forks — so a check that lived only server-side would
 * eventually exist in two versions. Re-running it locally means a hostile,
 * buggy, or self-hosted origin cannot inject an uncited flag.
 */
export const admit: (raw: unknown) => Effect.Effect<Digest, Schema.SchemaError, Brief> =
  Schema.decodeUnknownEffect(Digest)
