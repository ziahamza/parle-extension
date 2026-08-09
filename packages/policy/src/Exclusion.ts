/**
 * Why one address is on the Exclusion List — as a case, never a boolean.
 *
 * The Exclusion List is protection by enumeration and therefore incomplete by
 * nature, which is exactly why an exclusion must be able to say WHICH rule
 * fired. Two things depend on it. The settings page owes the reader "this page
 * was excluded because `chase.com` is in the bundled list, category banking",
 * because a reader who cannot see the reason cannot correct it. And a
 * Withholding rendered in the panel must offer "excluded — check anyway?"
 * rather than an empty panel, which is the whole answer to ADR 0005's own
 * objection that a silent false negative is one nobody can complain about.
 *
 * The cases are grouped by the four layers of ticket 03, and only one of them
 * is a list:
 *   1. mechanical — complete by construction, no source, no staleness
 *   2. listed     — a bundled domain artifact, incomplete and updatable
 *   3. shape      — what the address itself is carrying
 *   4. signal     — what the page said about itself
 * plus the reader's own entries, which win over all four.
 */
import * as Schema from "effect/Schema"

/**
 * What a listed domain is listed FOR.
 *
 * Rendered to the reader verbatim, so these are the reader's categories rather
 * than the upstream sources' — several sources collapse into `banking`, and
 * `health` deliberately claims less than the others (a domain list cannot cover
 * the category; see ticket 03 layer D).
 */
export const Category = Schema.Literals([
  "banking",
  "webmail",
  "health",
  "documents",
  "calendar",
  "search",
  "social",
  "government",
  "adult"
])
export type Category = typeof Category.Type

/** Which layer produced a listed entry. Updates may only ever add. */
export const Provenance = Schema.Literals(["bundled", "update", "reader"])
export type Provenance = typeof Provenance.Type

/**
 * The rule that excluded an address.
 *
 * A tagged union rather than a string so that the panel, the settings page and
 * the tests all read the same structure, and so that adding a rule is a change
 * every match site is forced to consider.
 */
export const Exclusion = Schema.TaggedUnion({
  /** Not a web address at all: `chrome:`, `file:`, `data:`, `about:`. */
  Scheme: { scheme: Schema.String },
  /** Loopback, private, link-local or CGNAT literal — there is no public page here. */
  PrivateAddress: { host: Schema.String, range: Schema.String },
  /** `intranet`, `wiki`, `jira` — no dot, therefore no public suffix. */
  SingleLabelHost: { host: Schema.String },
  /** `.local`, `.internal`, `.corp`, `.home.arpa`, `.lan`, `.test`, `.invalid`, `.onion`. */
  InternalSuffix: { host: Schema.String, suffix: Schema.String },
  /** `https://user:secret@host/…` — the address is itself a credential. */
  UserInfo: { host: Schema.String },
  /** The bundled domain artifact, or an additive update to it. */
  ListedDomain: { domain: Schema.String, category: Category, provenance: Provenance },
  /** A parameter whose NAME is a known credential or signature field. */
  CredentialParameter: { name: Schema.String },
  /** The OAuth authorization-code callback shape: `code` and `state` together. */
  AuthorizationCallback: {},
  /** A JSON Web Token sitting in the address. */
  JsonWebToken: { where: Schema.Literals(["path", "query"]) },
  /** A bare email address as a parameter value — the WOT harm, literally. */
  EmailAddress: { name: Schema.String },
  /** A whole segment or value that is structurally a token: UUID, long hex, base64. */
  TokenShaped: { where: Schema.Literals(["path", "query"]), shape: Schema.String },
  /** The page asked not to be indexed. The only page-signal that reaches a doc URL. */
  NotIndexed: {},
  /** The reader added this one themselves. */
  ReaderEntry: { host: Schema.String, pathPrefix: Schema.String }
})
export type Exclusion = typeof Exclusion.Type

/**
 * What the page said about itself.
 *
 * Only robots directives today. They are read from BOTH `meta[name="robots"]`
 * and the `X-Robots-Tag` header, because Google Docs, Drive, Box and Discord
 * signal only via the header — a DOM-only implementation misses precisely the
 * highest-value cases, which are the document-ID and meeting-ID URLs no domain
 * list can reach. Header access is unresolved on Safari, so the meta tag is the
 * cross-platform floor and the header is a Chrome enhancement; both land here
 * as raw strings and this module does not care which produced them.
 */
export interface PageSignals {
  /** Raw, untokenized directive values, as delivered. */
  readonly robots: ReadonlyArray<string>
}

/** A Reading that told us nothing about itself — an SPA route, or a signal we could not read. */
export const noSignals: PageSignals = { robots: [] }

/**
 * True when a robots value forbids indexing.
 *
 * Tokenized on commas and matched WHOLE, which is the entire subtlety: Google
 * Meet ships `content="none"`, which Google defines as equivalent to
 * `noindex, nofollow`, while `max-image-preview:none` contains the same four
 * letters and means nothing of the kind. A substring test excludes a large
 * amount of ordinary news media on the strength of an image-preview hint.
 */
export const forbidsIndexing = (signals: PageSignals): boolean =>
  signals.robots.some((value) =>
    value
      .split(",")
      .map((directive) => directive.trim().toLowerCase())
      // A keyed directive (`max-image-preview:none`) is never a bare token.
      .filter((directive) => !directive.includes(":"))
      .flatMap((directive) => directive.split(/\s+/))
      .some((token) => token === "noindex" || token === "none")
  )
