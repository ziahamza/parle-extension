/**
 * The rule that stopped a Lookup, said the way a person would say it.
 *
 * The Exclusion List is protection by enumeration and therefore incomplete by
 * nature, and ADR 0005's own objection to gating is that a silent false
 * negative is one nobody can complain about. A reader who is told only "this
 * page was excluded" cannot tell a bank from a typo in a domain list, so they
 * cannot correct it, so the objection stands. Naming the rule is what answers
 * it — and naming it in the reader's words rather than ours is what makes the
 * answer usable.
 *
 * Nothing in here is the project's vocabulary. `Exclusion.ListedDomain` is a
 * case name; what the reader gets is "Parle doesn't look up pages on your
 * bank's site". Every sentence completes "Parle isn't looking this page up
 * because …" and reads as a whole on its own, because it is shown on its own.
 */
import type { Category, Exclusion } from "@parle/policy/Exclusion"

/**
 * What a listed category means to the person reading, not to the list.
 *
 * `health` claims less than the others on purpose: a domain list cannot cover
 * the category (ticket 03, layer D), and a sentence implying otherwise is the
 * kind of overclaim this project has already refused to make in its README.
 */
const CATEGORY_WORDS = {
  banking: "it looks like a bank or a financial account",
  webmail: "it looks like a mail service",
  health: "it belongs to a hospital or a clinic",
  documents: "it looks like a document you were given a link to",
  calendar: "it looks like a calendar",
  search: "it is a search engine",
  social: "Parle reads this site rather than asking about it",
  government: "it is a government site",
  adult: "it is an adult site"
} satisfies Record<Category, string>

/**
 * The reason, in one sentence, or `null` when we have no better answer than the
 * generic one.
 *
 * Returning `null` rather than an apologetic sentence keeps the caller honest:
 * the panel has a general sentence for "this page is on the built-in list" and
 * should use it plainly rather than dress up an absence.
 */
export const groundWords = (exclusion: Exclusion): string => {
  switch (exclusion._tag) {
    case "Scheme":
      return `this isn't a web page — the address starts with ${exclusion.scheme}`
    case "PrivateAddress":
      return `${exclusion.host} is an address on a private network, so there is no public page here`
    case "SingleLabelHost":
      return `${exclusion.host} is a name that only exists inside your network`
    case "InternalSuffix":
      return `addresses ending ${exclusion.suffix} only exist inside your network`
    case "UserInfo":
      return "the address itself carries a username and password"
    case "ListedDomain":
      return `${CATEGORY_WORDS[exclusion.category]} — ${exclusion.domain} is on the built-in list`
    case "CredentialParameter":
      return `the address carries a "${exclusion.name}" value, which is usually a key or a signature`
    case "AuthorizationCallback":
      return "the address is a sign-in redirect and carries a one-time code"
    case "JsonWebToken":
      return "the address has a sign-in token in it"
    case "EmailAddress":
      return "the address has an email address in it"
    case "TokenLike":
      return `part of the address is a long random-looking ${exclusion.kind}, which is often a private share link`
    case "NotIndexed":
      return "the page asks search engines not to index it, so it is probably not public"
    case "ReaderEntry":
      return exclusion.pathPrefix === ""
        ? `you told Parle to leave ${exclusion.host} alone`
        : `you told Parle to leave ${exclusion.host}${exclusion.pathPrefix} alone`
  }
}

/**
 * The whole sentence the panel shows for an excluded page.
 *
 * Written here rather than in the panel because the fallback matters as much as
 * the specific case: when we cannot name the rule — the ground is computed
 * where the decision is made and does not travel with it in every path — the
 * reader still gets a true sentence naming their own site rather than a blank.
 */
export const exclusionWords = (ground: string | null, address: string): string => {
  if (ground !== null) return `Parle isn't looking this page up: ${ground}.`
  // The fallback still enumerates. "This page is skipped" would be short and
  // useless; the reader cannot tell a bank from a typo in a domain list without
  // knowing what kinds of thing are on it, and cannot correct it either.
  const host = hostOf(address)
  const kinds =
    "It skips banks, mail, health, government, adult and social sites, and addresses that look private."
  return host === null
    ? `Parle isn't looking this page up. ${kinds}`
    : `Parle doesn't look up pages on ${host}. ${kinds}`
}

export const hostOf = (address: string): string | null => {
  try {
    return new URL(address).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}
