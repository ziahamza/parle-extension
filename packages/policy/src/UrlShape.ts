/**
 * Layer 3 of the Exclusion List: what the address itself is carrying.
 *
 * This layer has a hard ceiling and the ADR states it plainly: short share
 * secrets are undetectable at any tolerable false-positive rate. An unlisted
 * YouTube video is `?v=` plus 11 base64url characters, byte-identical in shape
 * to a public one; `notion.so/Team-Roadmap-<32 hex>` and
 * `apnews.com/article/<slug>-<32 hex>` are the same string, so any rule that
 * catches the first excludes the entire AP wire. Nothing here should be read as
 * "we exclude URLs carrying credentials" — that claim is unsupportable and the
 * public copy must not make it.
 *
 * Two measured corrections shape what is and is not here.
 *
 * **Entropy is never used standalone.** Shannon entropy is length-capped at
 * log2(len), so a 22-character base64url token tops out at 4.459 and can never
 * reach the 4.5 threshold real scanners use, while 32-character hex tokens
 * average 3.61 bits/char — BELOW the 3.92 mean of ordinary English slugs. As a
 * standalone ranker it scores barely above chance. The single structural bit
 * "this segment contains no internal separator" scores far better, and that is
 * what {@link tokenShape} keys on.
 *
 * **No English-word suppressor.** It looks like it removes false positives and
 * mostly removes NON-ENGLISH ones — five times the false-positive rate on
 * `.jp`/`.cn`/`.kr`/`.ru` as on English TLDs — while blinding the detector to
 * exactly the private URLs that matter, because real private URLs are
 * `Team-Roadmap-<hex>` shaped.
 */
import * as Option from "effect/Option"
import { Exclusion } from "./Exclusion.ts"

/**
 * Parameter names that are a credential or a signature by definition.
 *
 * Drawn from primary specifications — AWS SigV4, Azure SAS, Google Cloud
 * Storage and CloudFront signed URLs, Dropbox share links — plus the words that
 * say what they are. Measured false-positive rate on real corpora: 0.004% and
 * 0.000%.
 */
const credentialParameters: ReadonlySet<string> = new Set([
  // AWS Signature Version 4 query authentication.
  "x-amz-algorithm",
  "x-amz-credential",
  "x-amz-signature",
  "x-amz-signedheaders",
  "x-amz-security-token",
  "x-amz-expires",
  "awsaccesskeyid",
  // Google Cloud Storage / CloudFront signed URLs.
  "x-goog-signature",
  "x-goog-credential",
  "key-pair-id",
  "goog-signature",
  // Azure Shared Access Signatures. These buy all the marginal recall at
  // exactly zero measured false-positive cost, and Azure SAS is otherwise
  // completely invisible to this layer.
  "sig",
  "sv",
  "st",
  "se",
  "sp",
  "sr",
  "spr",
  "e",
  // Dropbox share links.
  "rlkey",
  // Words that say what they are.
  "password",
  "passwd",
  "pwd",
  "api_key",
  "apikey",
  "secret",
  "client_secret",
  "access_token",
  "refresh_token",
  "id_token",
  "oauth_token",
  "auth_token",
  "session",
  "sessionid",
  "session_id",
  "jwt",
  "signature",
  "magic",
  "magic_link",
  "reset",
  "reset_token",
  "invite",
  "invite_token"
])

/**
 * Names deliberately NOT on the list above, with the reason.
 *
 * Measured: these five bought ZERO additional recall and caused every one of
 * the marginal false positives — landing on `youtu.be/…?t=317`, on forum
 * `showthread.php?t=…`, and on `?state=CA`. Kept as an exported constant rather
 * than a comment so that a future contributor re-adding one has to delete an
 * explicit decision.
 */
export const rejectedParameterNames: ReadonlyArray<string> = ["t", "state", "u", "code", "s"]

const jwtPattern = /^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/
const emailPattern = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const longHexPattern = /^[0-9a-f]{32,}$/i
const base64ishPattern = /^[A-Za-z0-9_\-+/=]{20,}$/

/**
 * Name the token shape of a whole segment or value, if it has one.
 *
 * Whole-segment anchoring is what makes this usable: `abc123def456` inside
 * `my-article-abc123def456` is not a match, because a private URL puts the
 * token in a segment of its own or at the end of a slug we cannot distinguish
 * from a wire-service article id.
 *
 * The base64 rule requires lower AND upper AND digit together. That single
 * conjunction is what keeps the AP wire, ordinary news slugs and every
 * lowercase-and-dashes CMS out, while still catching a 44-character Azure SAS
 * signature — whose alphabet is why `+`, `/` and `=` are in the character class.
 */
export const tokenShape = (value: string): string | undefined => {
  if (uuidPattern.test(value)) return "uuid"
  if (longHexPattern.test(value)) return "hex"
  if (!base64ishPattern.test(value)) return undefined
  const hasLower = /[a-z]/.test(value)
  const hasUpper = /[A-Z]/.test(value)
  const hasDigit = /[0-9]/.test(value)
  return hasLower && hasUpper && hasDigit ? "base64" : undefined
}

/**
 * Apply every URL-shape rule to an address.
 *
 * Run against the CANONICAL address, not the raw one, so that the fragment and
 * the tracking parameters are already gone. That ordering matters twice over:
 * the fragment is where a large share of secret-bearing URLs put the secret,
 * and share-attribution parameters would otherwise fire this layer on ordinary
 * social links.
 */
export const urlShape = (raw: string): Option.Option<Exclusion> => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return Option.none()
  }

  const params = [...new URLSearchParams(url.search)]

  for (const [name, value] of params) {
    const lower = name.toLowerCase()
    if (credentialParameters.has(lower)) {
      return Option.some(Exclusion.cases.CredentialParameter.make({ name: lower }))
    }
    if (jwtPattern.test(value)) {
      return Option.some(Exclusion.cases.JsonWebToken.make({ where: "query" }))
    }
    if (emailPattern.test(value)) {
      return Option.some(Exclusion.cases.EmailAddress.make({ name: lower }))
    }
  }

  // `code` and `state` are worthless apart — they are the two names that caused
  // every marginal false positive — but together they are the OAuth 2.0
  // authorization-code callback of RFC 6749 §4.1.2 and nothing else. This
  // conjunction is a PROPOSAL: it is reasoned from the spec, not measured on a
  // corpus, and it should be measured before the recall claim is made anywhere.
  const names = new Set(params.map(([n]) => n.toLowerCase()))
  if (names.has("code") && names.has("state")) {
    return Option.some(Exclusion.cases.AuthorizationCallback.make({}))
  }

  for (const [, value] of params) {
    const shape = tokenShape(value)
    if (shape !== undefined) return Option.some(Exclusion.cases.TokenShaped.make({ where: "query", shape }))
  }

  for (const segment of url.pathname.split("/")) {
    if (segment.length === 0) continue
    if (jwtPattern.test(segment)) return Option.some(Exclusion.cases.JsonWebToken.make({ where: "path" }))
    const shape = tokenShape(segment)
    if (shape !== undefined) return Option.some(Exclusion.cases.TokenShaped.make({ where: "path", shape }))
  }

  return Option.none()
}
