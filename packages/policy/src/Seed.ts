/**
 * Layer 2 of the Exclusion List: the bundled domain artifact, and its seed.
 *
 * This file is a SEED, not the list. The real artifact is built from UT1
 * Capitole, CISA `.gov`, Blocklist Project and Wikidata, collapsed to eTLD+1
 * against the Public Suffix List, and it cannot live here: those sources are
 * CC BY-SA 4.0, which is not compatible with this repo's AGPL-3.0, so the
 * artifact must ship as a separate, separately-licensed data file rather than
 * be inlined into a JavaScript bundle. {@link DomainArtifact} is the shape that
 * file decodes to, and {@link withUpdate} is how it replaces what is here.
 *
 * Every entry below is the project's own compilation of facts (hostnames), not
 * copyrightable expression, so it carries this repo's licence and no other.
 * It is weighted towards what the best available upstream list was measured to
 * be MISSING, because those are the domains a store reviewer actually types:
 * `proton.me` and `tuta.com` (UT1 still lists only `protonmail.com` and
 * `tutanota.com`), `icloud.com`, `outlook.office.com`, `coinbase.com`,
 * `monzo.com`, `schwab.com`, `bsky.app`.
 *
 * One rule about this layer that is easy to get wrong and expensive to discover
 * late: **the Exclusion List gates Lookups only, never Harvest.** `reddit.com`
 * and `news.ycombinator.com` are listed here because a Lookup on them is
 * self-referential and pointless — not because we stop reading them. Wiring
 * this list into the Harvest path would stop the Local Discussion Cache filling
 * from the exact pages it exists to be filled from.
 */
import type { Category, Provenance } from "./Exclusion.ts"

/** One listed domain, matched against a host and every subdomain of it. */
export interface ListedEntry {
  /** A registrable domain, or a specific host when the vendor splits by host. */
  readonly domain: string
  readonly category: Category
}

/**
 * The decoded form of the shipped exclusion artifact.
 *
 * `version` is a monotonic integer. It is the same number on the file bundled
 * in the extension and on the file published to the artifact host, because the
 * build emits it once and both consume the identical bytes — there is no drift
 * to keep in sync because there is only one artifact per version.
 */
export interface DomainArtifact {
  readonly version: number
  readonly entries: ReadonlyArray<ListedEntry>
}

/**
 * Fold a published update into the bundled artifact, additively.
 *
 * Additive-only is enforced HERE rather than trusted, which turns "the artifact
 * host can only ever improve your privacy, never widen your exposure" into a
 * property of the code instead of a promise about a server. A removal ships
 * exclusively in a new extension release, where it passes through store review.
 * The consequence worth stating: a compromised or absent artifact host is
 * harmless, so this loader never needs to authenticate anything to be safe.
 */
export const withUpdate = (bundled: DomainArtifact, update: DomainArtifact): DomainArtifact => {
  if (update.version <= bundled.version) return bundled
  const byDomain = new Map<string, ListedEntry>()
  for (const entry of bundled.entries) byDomain.set(entry.domain, entry)
  for (const entry of update.entries) if (!byDomain.has(entry.domain)) byDomain.set(entry.domain, entry)
  return { version: update.version, entries: [...byDomain.values()] }
}

/** Where a matched entry came from, for the settings page. */
export const provenanceOf = (artifact: DomainArtifact): Provenance =>
  artifact.version > seed.version ? "update" : "bundled"

const entries: ReadonlyArray<ListedEntry> = [
  // Banking and finance. The four after the majors are the ones verified
  // absent from the best upstream list, and the ones reviewers test.
  { domain: "chase.com", category: "banking" },
  { domain: "wellsfargo.com", category: "banking" },
  { domain: "bankofamerica.com", category: "banking" },
  { domain: "citi.com", category: "banking" },
  { domain: "usbank.com", category: "banking" },
  { domain: "capitalone.com", category: "banking" },
  { domain: "americanexpress.com", category: "banking" },
  { domain: "paypal.com", category: "banking" },
  { domain: "stripe.com", category: "banking" },
  { domain: "wise.com", category: "banking" },
  { domain: "revolut.com", category: "banking" },
  { domain: "coinbase.com", category: "banking" },
  { domain: "kraken.com", category: "banking" },
  { domain: "binance.com", category: "banking" },
  { domain: "monzo.com", category: "banking" },
  { domain: "starlingbank.com", category: "banking" },
  { domain: "schwab.com", category: "banking" },
  { domain: "fidelity.com", category: "banking" },
  { domain: "vanguard.com", category: "banking" },
  { domain: "barclays.co.uk", category: "banking" },
  { domain: "lloydsbank.com", category: "banking" },
  { domain: "hsbc.com", category: "banking" },
  { domain: "nationwide.co.uk", category: "banking" },
  { domain: "santander.co.uk", category: "banking" },

  // Webmail. UT1's category is fossilised — it lists `eudoramail.com` and
  // `caramail.com` and neither of Proton's or Tuta's current domains.
  { domain: "mail.google.com", category: "webmail" },
  { domain: "outlook.live.com", category: "webmail" },
  { domain: "outlook.office.com", category: "webmail" },
  { domain: "outlook.office365.com", category: "webmail" },
  { domain: "outlook.cloud.microsoft", category: "webmail" },
  { domain: "mail.yahoo.com", category: "webmail" },
  { domain: "icloud.com", category: "webmail" },
  { domain: "proton.me", category: "webmail" },
  { domain: "protonmail.com", category: "webmail" },
  { domain: "tuta.com", category: "webmail" },
  { domain: "tutanota.com", category: "webmail" },
  { domain: "gmx.com", category: "webmail" },
  { domain: "gmx.net", category: "webmail" },
  { domain: "zoho.com", category: "webmail" },
  { domain: "fastmail.com", category: "webmail" },
  { domain: "hey.com", category: "webmail" },

  // Documents and file shares. Host-level, from vendor-published endpoint
  // lists, because `google.com` and `dropbox.com` themselves must stay lookupable.
  { domain: "docs.google.com", category: "documents" },
  { domain: "drive.google.com", category: "documents" },
  { domain: "sheets.google.com", category: "documents" },
  { domain: "slides.google.com", category: "documents" },
  { domain: "sites.google.com", category: "documents" },
  { domain: "keep.google.com", category: "documents" },
  { domain: "sharepoint.com", category: "documents" },
  { domain: "onedrive.live.com", category: "documents" },
  { domain: "office.com", category: "documents" },
  { domain: "notion.so", category: "documents" },
  { domain: "dropbox.com", category: "documents" },
  { domain: "box.com", category: "documents" },
  { domain: "quip.com", category: "documents" },
  { domain: "coda.io", category: "documents" },
  { domain: "airtable.com", category: "documents" },

  // Calendar and meetings.
  { domain: "calendar.google.com", category: "calendar" },
  { domain: "meet.google.com", category: "calendar" },
  { domain: "zoom.us", category: "calendar" },
  { domain: "teams.live.com", category: "calendar" },
  { domain: "teams.microsoft.com", category: "calendar" },
  { domain: "calendly.com", category: "calendar" },
  { domain: "cal.com", category: "calendar" },

  // Health. A partial mitigation, never category coverage: the real risk lives
  // behind authentication on hosts nobody enumerates, and a list broad enough
  // to catch a patient portal also suppresses the medical journalism this
  // product is most useful on. `noindex` and URL shape carry the rest.
  { domain: "mychart.com", category: "health" },
  { domain: "mychart.org", category: "health" },
  { domain: "patientaccess.com", category: "health" },
  { domain: "nhs.uk", category: "health" },
  { domain: "healthcare.gov", category: "health" },
  { domain: "23andme.com", category: "health" },
  { domain: "zocdoc.com", category: "health" },
  { domain: "goodrx.com", category: "health" },

  // Search engines: self-referential, and a Lookup returns nothing useful.
  { domain: "google.com", category: "search" },
  { domain: "bing.com", category: "search" },
  { domain: "duckduckgo.com", category: "search" },
  { domain: "search.brave.com", category: "search" },
  { domain: "ecosia.org", category: "search" },
  { domain: "startpage.com", category: "search" },
  { domain: "baidu.com", category: "search" },
  { domain: "yandex.com", category: "search" },
  { domain: "perplexity.ai", category: "search" },

  // Social feeds. `reddit.com` and `news.ycombinator.com` are here because a
  // Lookup on them is pointless — NOT to stop Harvest reading them.
  { domain: "facebook.com", category: "social" },
  { domain: "instagram.com", category: "social" },
  { domain: "threads.net", category: "social" },
  { domain: "tiktok.com", category: "social" },
  { domain: "linkedin.com", category: "social" },
  { domain: "snapchat.com", category: "social" },
  { domain: "bsky.app", category: "social" },
  { domain: "mastodon.social", category: "social" },
  { domain: "x.com", category: "social" },
  { domain: "twitter.com", category: "social" },
  { domain: "reddit.com", category: "social" },
  { domain: "news.ycombinator.com", category: "social" },

  // Government. A stand-in for the 16,451-domain CISA `.gov` set, which is
  // CC0-1.0 and therefore belongs in the artifact, not in this file.
  { domain: "irs.gov", category: "government" },
  { domain: "ssa.gov", category: "government" },
  { domain: "login.gov", category: "government" },
  { domain: "gov.uk", category: "government" },
  { domain: "service.gov.uk", category: "government" },

  // Adult. A stand-in for the Majestic-capped set; kept deliberately tiny here.
  { domain: "pornhub.com", category: "adult" },
  { domain: "xvideos.com", category: "adult" },
  { domain: "onlyfans.com", category: "adult" }
]

/**
 * The list that ships when no artifact has been loaded.
 *
 * Version 0 so that ANY published artifact supersedes it, and so that
 * {@link provenanceOf} can tell the reader whether an entry came from the
 * binary they installed or from an update.
 */
export const seed: DomainArtifact = { version: 0, entries }
