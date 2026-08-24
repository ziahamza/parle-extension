#!/usr/bin/env node

/**
 * Compiles `data/standing.json` — what named public raters say about a
 * publisher — from four published datasets, on a developer's machine.
 *
 *   node packages/standing/tools/build.ts            → rebuild the artifact
 *   node packages/standing/tools/build.ts --dry-run  → build it, print the
 *                                                      report, write nothing
 *
 * **This never runs on a reader's machine, and that is the whole design.** Every
 * per-page request a reader issues tells whoever answers it what the reader is
 * reading; a rating that is compiled once, here, and shipped inside the build
 * discloses nothing at all. `docs/research/enrichment-sources.md` states the
 * rule this obeys — *a static artifact compiled at build time beats a live
 * Lookup wherever both exist* — and this file is that document's §1 made
 * executable. `docs/adr/0022` is why we ship it at all, and on what terms.
 *
 * Run with plain `node`. Node 24 strips the types at load, which is the same
 * arrangement `store/*.ts` uses and for the same reason: there is no build step,
 * so there is no compiled copy to fall out of sync with the source. The
 * companion `tsconfig.tools.json` type-checks it without emitting.
 *
 * ## Politeness
 *
 * Five requests, issued one after another with a pause between them, under a
 * User-Agent that names the project and a contact. Four of them are the four
 * layers; the fifth is the one attempt this build makes on allsides.com itself,
 * which exists so that the provenance block can record a *measured* refusal
 * rather than a remembered one. Nothing here is parallel and nothing here
 * retries: a source that will not answer today is recorded as a gap, and the
 * artifact ships without that layer. Fabricating a layer we could not fetch
 * would be worse than shipping without it, because the reader cannot tell the
 * difference and the provenance block would be a lie.
 *
 * ## What is joined to what
 *
 * Wikipedia's list and the Iffy Index are already keyed by domain. AllSides is
 * keyed by outlet *name*, which is why Wikidata is here: P856 (official website)
 * turns "ABC News" into `abcnews.go.com`. The join runs twice — once through the
 * enwiki article URL AllSides itself publishes, which is exact, and once through
 * an English label match, which is not — and {@link OVERRIDES} catches the big
 * outlets both passes miss. Every unjoined AllSides row is reported at the end,
 * because an outlet silently dropped is an outlet the panel will never mention.
 *
 * ## What the merge refuses to write
 *
 * Three rules, all of which cost real claims on well-known publishers, and all
 * of which are documented where they are applied:
 *
 *   - a rater that says two different things about one domain gets **no claim**
 *     rather than an adjudicated one (ADR 0006);
 *   - AllSides' ratings of individual columnists and of opinion sections are
 *     dropped, because the only key here is a publisher's domain;
 *   - a domain several unrelated outlets resolve to is a bad join, not a busy
 *     publisher, and its lean is dropped.
 *
 * Each is counted and printed. A number that moves sharply between refreshes is
 * the signal that a source changed shape.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, "..")
const OUT = join(PACKAGE_ROOT, "data", "standing.json")

/**
 * Named, with a contact, because WDQS asks for exactly that and because a
 * source that wants to complain about this build should be able to find us
 * rather than block a subnet.
 */
const USER_AGENT =
  "ParleStandingBuild/1.0 (https://github.com/ziahamza/parle-extension; build-time artifact compiler)"

/** Milliseconds between requests. Nothing here is in a hurry. */
const PAUSE_MS = 1_500

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const DRY_RUN = process.argv.includes("--dry-run")

// ---------------------------------------------------------------------------
// The shape being written. Kept in step with ../src/Artifact.ts by that file's
// schema, which is run over this file's output by Artifact.test.ts.
// ---------------------------------------------------------------------------

type Obtained = "direct" | "mirror" | "unavailable"

interface Rater {
  readonly name: string
  readonly license: string
  readonly licenseUrl: string
  readonly sourceUrl: string
  readonly fetchedAt: string
  readonly obtained: Obtained
  readonly entries: number
  readonly note?: string
}

interface Entry {
  name?: string
  allsides?: string
  wikipediaRsp?: string
  iffy?: string
  wikidata?: {
    alignment?: string
    founded?: string
    owner?: string
    country?: string
  }
}

/**
 * What the merge knows about a domain before it decides what to write.
 *
 * Separate from {@link Entry} because two of these fields must never reach the
 * artifact and one of them is a `Set`, which `JSON.stringify` would silently
 * write as `{}`.
 *
 * `rspStatuses` is a set rather than a value because Wikipedia's list has more
 * than one row for some publishers — Fox News is rated separately for politics
 * and science and for everything else — and those rows carry different statuses
 * against one domain. `names` is three slots rather than one because the three
 * layers spell a publisher very differently and only one of them is spelling it
 * for a reader.
 */
interface Working {
  readonly rspStatuses: Set<string>
  readonly allsidesRatings: Set<string>
  /**
   * Which AllSides outlets the automatic passes claim this domain for.
   *
   * More than one *unrelated* outlet landing on a domain is the signature of a
   * bad join rather than of a busy publisher: `hdl.loc.gov` collected four
   * different leans this way, because several Wikidata items record a Library of
   * Congress handle as their official website. See the decision below.
   */
  readonly allsidesClaimants: Set<string>
  /** Set when a domain came from {@link OVERRIDES}, which is checked by hand. */
  allsidesByHand?: boolean
  names: { rsp?: string; iffy?: string; allsides?: string }
  iffy?: string
  wikidata?: Entry["wikidata"]
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

interface Fetched {
  readonly ok: boolean
  readonly status: number
  readonly body: string
  readonly detail?: string
}

let requestsIssued = 0

const politeFetch = async (url: string, init?: RequestInit): Promise<Fetched> => {
  if (requestsIssued > 0) await pause(PAUSE_MS)
  requestsIssued += 1
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, ...(init?.headers ?? {}) }
    })
    const body = await response.text()
    return { ok: response.ok, status: response.status, body }
  } catch (cause) {
    return { ok: false, status: 0, body: "", detail: cause instanceof Error ? cause.message : String(cause) }
  }
}

// ---------------------------------------------------------------------------
// Layer 1 — Wikipedia's perennial sources list (CC BY-SA 4.0)
// ---------------------------------------------------------------------------

/**
 * The list's own five statuses, in the list's own words, lowercased and
 * hyphenated. They are not collapsed into a reliable/unreliable boolean: "no
 * consensus" is a genuinely different thing to say about a publisher than
 * "generally unreliable", and a reader shown the second when the community said
 * the first has been misinformed by us rather than by Wikipedia.
 */
const RSP_STATUS_BY_CLASS: Record<string, string> = {
  "s-gr": "generally-reliable",
  "s-nc": "no-consensus",
  "s-gu": "generally-unreliable",
  "s-d": "deprecated",
  "s-b": "blacklisted"
}

/** The status cell's own icon title, for the rows whose class is `s-m`. */
const RSP_STATUS_BY_TITLE: Record<string, string> = {
  "Generally reliable": "generally-reliable",
  "No consensus": "no-consensus",
  "Generally unreliable": "generally-unreliable",
  "Deprecated": "deprecated",
  "Blacklisted": "blacklisted"
}

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

const stripTags = (html: string): string =>
  html
    .replace(/<span class="wp-rsp-sc">[\s\S]*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()

interface RspRow {
  readonly name: string
  readonly status: string
  readonly domains: ReadonlyArray<string>
  readonly articles: ReadonlyArray<string>
}

/**
 * One request, for the *rendered* page rather than its wikitext.
 *
 * The wikitext is a shell: the 490-odd rows live in seven transcluded subpages
 * (`/1` … `/7`), so reading the source honestly would cost seven more requests.
 * The rendered HTML has every row in it, and — the part that makes this
 * tractable at all — every row carries its status in the `<tr>` class and its
 * domains in the two tool links the list template generates for each entry: a
 * `Special:Search/insource:"…"` link and a spamcheck link. Neither was put there
 * for us, so both are checked against {@link DOMAIN_PATTERN} rather than
 * trusted.
 */
const fetchWikipediaRsp = async (): Promise<{ rows: ReadonlyArray<RspRow>; rater: Rater }> => {
  const sourceUrl = "https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources"
  const api =
    "https://en.wikipedia.org/w/api.php?action=parse&page=Wikipedia%3AReliable%20sources%2FPerennial%20sources" +
    "&prop=text&format=json&formatversion=2"
  const fetchedAt = new Date().toISOString()
  const response = await politeFetch(api)

  const base: Rater = {
    name: "Wikipedia: Reliable sources/Perennial sources",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourceUrl,
    fetchedAt,
    obtained: "direct",
    entries: 0
  }

  if (!response.ok) {
    return {
      rows: [],
      rater: {
        ...base,
        obtained: "unavailable",
        note: `The MediaWiki parse API answered ${response.status}${response.detail ? ` (${response.detail})` : ""}; this layer is absent from this build.`
      }
    }
  }

  let html: string
  try {
    html = (JSON.parse(response.body) as { parse: { text: string } }).parse.text
  } catch {
    return { rows: [], rater: { ...base, obtained: "unavailable", note: "The parse API answered unusably." } }
  }

  const rows: Array<RspRow> = []
  for (const match of html.matchAll(/<tr class="(s-[a-z]+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cssClass = match[1] ?? ""
    const body = match[2] ?? ""
    const cells = body.split("</td>")
    const first = cells[0] ?? ""
    const second = cells[1] ?? ""

    const byTitle = [...second.matchAll(/title="([^"]+)"/g)]
      .map((m) => RSP_STATUS_BY_TITLE[m[1] ?? ""])
      .find((value) => value !== undefined)
    const status = RSP_STATUS_BY_CLASS[cssClass] ?? byTitle
    if (status === undefined) continue

    const domains = new Set<string>()
    for (const m of body.matchAll(/insource:%22([^%"]+)%22/g)) domains.add(decodeURIComponent(m[1] ?? ""))
    for (const m of body.matchAll(/spamcheck\.toolforge\.org\/by-domain\?q=([^"&]+)/g)) {
      domains.add(decodeURIComponent(m[1] ?? ""))
    }

    const articles = new Set<string>()
    for (const m of first.matchAll(/href="\/wiki\/([^"#:]+)"/g)) articles.add(decodeURIComponent(m[1] ?? ""))

    const name = stripTags(first)
    if (name.length === 0) continue

    rows.push({
      name,
      status,
      domains: [...domains].map((d) => d.toLowerCase()).filter((d) => DOMAIN_PATTERN.test(d)),
      articles: [...articles]
    })
  }

  return { rows, rater: { ...base, entries: rows.length } }
}

// ---------------------------------------------------------------------------
// Layer 2 — the Iffy Index (CC BY 4.0)
// ---------------------------------------------------------------------------

/** A CSV reader that understands quotes, because outlet names contain commas. */
const parseCsv = (text: string): ReadonlyArray<ReadonlyArray<string>> => {
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ",") {
      row.push(field)
      field = ""
    } else if (char === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else if (char !== "\r") field += char
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * The Iffy Index's MBFC-derived factual-reporting letters, spelled out.
 *
 * The published sheet also carries an `MBFC Bias` column — a left/right rating.
 * **It is deliberately not read.** ADR 0022 records why: Media Bias/Fact Check's
 * ratings are licensed, the route to them is an email rather than a scrape, and
 * lifting their left/right column out of somebody else's CC BY republication
 * would be taking the thing we said we would not take through a side door. The
 * factual-reporting letter is what the Iffy Index is *for* — it is the index of
 * unreliable sites — and that is what this layer ships.
 */
const IFFY_FACTUAL: Record<string, string> = {
  VL: "very-low",
  L: "low",
  M: "mixed",
  MF: "mostly-factual",
  H: "high",
  VH: "very-high"
}

interface IffyRow {
  readonly domain: string
  readonly name: string
  readonly factual: string
}

const fetchIffy = async (): Promise<{ rows: ReadonlyArray<IffyRow>; rater: Rater }> => {
  // The published sheet, linked from iffy.news/index/ as its CSV export. The
  // gviz URL is what that page's own "CSV" link points at.
  const sourceUrl =
    "https://docs.google.com/spreadsheets/d/1ck1_FZC-97uDLIlvRJDTrGqBk0FuDe9yHkluROgpGS8/gviz/tq?tqx=out:csv&sheet=Iffy-news"
  const fetchedAt = new Date().toISOString()
  const response = await politeFetch(sourceUrl)

  const base: Rater = {
    name: "The Iffy Index of Unreliable Sources",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourceUrl: "https://iffy.news/index/",
    fetchedAt,
    obtained: "direct",
    entries: 0
  }

  if (!response.ok) {
    return {
      rows: [],
      rater: {
        ...base,
        obtained: "unavailable",
        note: `The published sheet answered ${response.status}${response.detail ? ` (${response.detail})` : ""}; this layer is absent from this build.`
      }
    }
  }

  const table = parseCsv(response.body)
  const header = table[0] ?? []
  const at = (name: string): number => header.indexOf(name)
  const iDomain = at("Domain")
  const iName = at("Name")
  const iFact = at("MBFC Fact")
  if (iDomain < 0) {
    return { rows: [], rater: { ...base, obtained: "unavailable", note: "The sheet's columns were not the expected ones." } }
  }

  const rows: Array<IffyRow> = []
  for (const line of table.slice(1)) {
    const domain = (line[iDomain] ?? "").trim().toLowerCase()
    if (!DOMAIN_PATTERN.test(domain)) continue
    const factual = IFFY_FACTUAL[(line[iFact] ?? "").trim()]
    rows.push({ domain, name: (line[iName] ?? "").trim(), factual: factual ?? "unrated" })
  }

  return { rows, rater: { ...base, entries: rows.length, note: `Published as ${sourceUrl}` } }
}

// ---------------------------------------------------------------------------
// Layer 3 — AllSides (CC BY-NC 4.0)
// ---------------------------------------------------------------------------

/**
 * AllSides' five-point scale, in AllSides' own words.
 *
 * The mirror spells them `left` / `left-center` / `center` / `right-center` /
 * `right`; AllSides displays them as "Left", "Lean Left", "Center", "Lean
 * Right", "Right". The artifact keeps the mirror's spelling and
 * `../src/Standing.ts` does the displaying, so the words a reader sees are in
 * reviewable source rather than in a data file.
 */
const ALLSIDES_RATINGS = new Set(["left", "left-center", "center", "right-center", "right"])

/**
 * AllSides rates individual columnists as well as publications, and a third of
 * the mirror's rows are people: "Bret Stephens", "Charles Blow", forty-odd
 * editorial cartoonists. **They are dropped, not merely left unjoined.**
 *
 * A Standing is a claim about the *publisher* of the page in front of the
 * reader. Bret Stephens' AllSides rating is a claim about Bret Stephens; hung
 * on `wsj.com` — which is where any name-to-domain join would eventually put
 * it — it would read as a rating of The Wall Street Journal that AllSides never
 * made. The type column is how AllSides itself tells the two apart, so it is
 * what decides here.
 */
const ALLSIDES_PUBLISHER_TYPES = new Set(["news media", "think tank / policy group"])

/**
 * AllSides also rates the *opinion side* of a paper separately from its news
 * side — "New York Times - Opinion" is rated Left where "New York Times - News"
 * is rated Lean Left. **The opinion rows are dropped**, for the same reason the
 * columnists are: they are ratings of a section, and the only key this artifact
 * has is the publisher's domain. A reader on a news article shown the editorial
 * page's rating has been told something AllSides did not say about the page they
 * are on.
 *
 * The news-side row is kept and its section suffix trimmed by
 * {@link stripSectionSuffix}, because that is the row that describes the pages
 * readers mostly arrive on. Where a publisher has *only* an opinion row in the
 * mirror, it ends up with no AllSides lean at all — Fox News is the notable
 * casualty — and that gap is real and reported rather than papered over.
 */
const ALLSIDES_OPINION_ROW = /\b(opinion|editorial)\b/i

/**
 * Rows in the mirror that are not outlets at all. `Test Source` is rated
 * "center" and has been sitting in the published data since at least 2019; left
 * in, its label match lands on `foxnews.com` and takes Fox's own rating down
 * with it as a false disagreement.
 */
const ALLSIDES_JUNK_ROWS: ReadonlySet<string> = new Set(["Test Source", "AllSides"])

/** "New York Times - News" → "New York Times". */
const stripSectionSuffix = (name: string): string =>
  name
    .replace(/\s*[-–—]\s*(web\s+)?news$/i, "")
    .replace(/\s*\((web\s+news|online\s+news)\)$/i, "")
    .replace(/\s+(online\s+news|web\s+news)$/i, "")
    .trim()

interface AllSidesRow {
  readonly name: string
  readonly rating: string
  readonly article: string | undefined
}

/**
 * Try allsides.com once. Expect a 403, record what actually happened.
 *
 * allsides.com sits behind a bot defence that refuses automated clients, so this
 * request is not really an attempt to get the data — it is the measurement that
 * lets the provenance block say *why* the data came from somewhere else. If it
 * ever starts answering, the note in the artifact will say so and this build
 * should be rewritten to read it directly.
 */
const fetchAllSides = async (): Promise<{ rows: ReadonlyArray<AllSidesRow>; rater: Rater }> => {
  const canonical = "https://www.allsides.com/media-bias/ratings"
  const fetchedAt = new Date().toISOString()
  const direct = await politeFetch(canonical)

  const mirror = "https://raw.githubusercontent.com/favstats/AllSideR/master/data/allsides_data.csv"
  const base: Rater = {
    name: "AllSides Media Bias Ratings",
    license: "CC BY-NC 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
    sourceUrl: canonical,
    fetchedAt,
    obtained: "mirror",
    entries: 0
  }

  const refusal = direct.ok
    ? "allsides.com answered this build, which it has not done before — re-check whether it can now be read directly."
    : `allsides.com answered ${direct.status}${direct.detail ? ` (${direct.detail})` : ""} to an automated client.`

  const response = await politeFetch(mirror)
  if (!response.ok) {
    return {
      rows: [],
      rater: {
        ...base,
        obtained: "unavailable",
        note: `${refusal} The community mirror at ${mirror} then answered ${response.status}; this layer is absent from this build.`
      }
    }
  }

  const table = parseCsv(response.body)
  const header = table[0] ?? []
  const iName = header.indexOf("news_source")
  const iRating = header.indexOf("rating")
  const iWiki = header.indexOf("wiki")
  const iType = header.indexOf("type")
  if (iName < 0 || iRating < 0 || iType < 0) {
    return { rows: [], rater: { ...base, obtained: "unavailable", note: `${refusal} The mirror's columns were not the expected ones.` } }
  }

  const rows: Array<AllSidesRow> = []
  for (const line of table.slice(1)) {
    const name = (line[iName] ?? "").trim()
    const rating = (line[iRating] ?? "").trim().toLowerCase()
    if (name.length === 0 || !ALLSIDES_RATINGS.has(rating)) continue
    if (!ALLSIDES_PUBLISHER_TYPES.has((line[iType] ?? "").trim().toLowerCase())) continue
    if (ALLSIDES_OPINION_ROW.test(name)) continue
    if (ALLSIDES_JUNK_ROWS.has(name)) continue
    const wiki = (line[iWiki] ?? "").trim()
    const article = /^https:\/\/en\.wikipedia\.org\/wiki\//.test(wiki)
      ? decodeURIComponent(wiki.replace("https://en.wikipedia.org/wiki/", ""))
      : undefined
    rows.push({ name, rating, article })
  }

  return {
    rows,
    rater: {
      ...base,
      entries: rows.length,
      note:
        `${refusal} The ratings were therefore read from the community mirror ${mirror}, ` +
        `whose own last commit predates this build — treat AllSides positions here as the mirror's vintage, not as today's AllSides.`
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 4 — Wikidata (CC0)
// ---------------------------------------------------------------------------

interface WikidataRow {
  readonly item: string
  readonly domains: ReadonlyArray<string>
  readonly article: string | undefined
  readonly matchedName: string | undefined
  readonly alignment: string | undefined
  readonly founded: string | undefined
  readonly owner: string | undefined
  readonly country: string | undefined
}

const hostOf = (url: string): string | undefined => {
  try {
    const host = new URL(url).host.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "")
    return DOMAIN_PATTERN.test(host) ? host : undefined
  } catch {
    return undefined
  }
}

/** The label service occasionally hands back the Q-id it could not label. */
const realLabel = (value: string | undefined): string | undefined =>
  value === undefined || /^Q\d+$/.test(value) ? undefined : value

/**
 * One SPARQL query, scoped to the outlets the other three layers already name.
 *
 * The obvious query — every media organisation with an official website — is
 * both slower for WDQS and wrong for us: it would put tens of thousands of
 * publishers into a 250 KB artifact for the sake of a founding date, and no
 * reader ever sees a publisher no rater has rated. So the query is a `VALUES`
 * join on two keys we already hold, in one round trip:
 *
 *   - the enwiki article URLs the RSP rows and the AllSides mirror publish,
 *     which is an exact identification, and
 *   - the AllSides outlet names as English labels, which is not — a label match
 *     with no type constraint can land on the wrong item, so a name that
 *     resolves to more than one item is dropped rather than guessed at.
 *
 * P1387 (political alignment) rides along because it is a rating in its own
 * right and a differently-sourced one: Wikidata's editors, not AllSides'
 * panels. P571 / P127 / P17 ride along as publisher facts, and the merge below
 * keeps them only for publishers some rater has actually rated.
 */
const fetchWikidata = async (
  articles: ReadonlyArray<string>,
  names: ReadonlyArray<string>
): Promise<{ rows: ReadonlyArray<WikidataRow>; rater: Rater }> => {
  const endpoint = "https://query.wikidata.org/sparql"
  const fetchedAt = new Date().toISOString()

  const articleValues = articles
    .map((title) => `<https://en.wikipedia.org/wiki/${encodeURI(title.replace(/ /g, "_")).replace(/#/g, "%23")}>`)
    .join(" ")
  const nameValues = names
    .map((name) => `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"@en`)
    .join(" ")

  const query = `SELECT ?item ?article ?website ?matchedName ?alignmentLabel ?inception ?ownerLabel ?countryLabel WHERE {
  {
    VALUES ?article { ${articleValues} }
    ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
    ?item wdt:P856 ?website .
  } UNION {
    VALUES ?matchedName { ${nameValues} }
    ?item rdfs:label ?matchedName .
    ?item wdt:P856 ?website .
    OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  }
  OPTIONAL { ?item wdt:P1387 ?alignment . }
  OPTIONAL { ?item wdt:P571 ?inception . }
  OPTIONAL { ?item wdt:P127 ?owner . }
  OPTIONAL { ?item wdt:P17 ?country . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`

  const base: Rater = {
    name: "Wikidata",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://query.wikidata.org/",
    fetchedAt,
    obtained: "direct",
    entries: 0
  }

  const response = await politeFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json"
    },
    body: new URLSearchParams({ query }).toString()
  })

  if (!response.ok) {
    return {
      rows: [],
      rater: {
        ...base,
        obtained: "unavailable",
        note: `WDQS answered ${response.status}${response.detail ? ` (${response.detail})` : ""}; this layer is absent from this build, and with it the AllSides name-to-domain join.`
      }
    }
  }

  type Binding = Record<string, { value: string } | undefined>
  let bindings: ReadonlyArray<Binding>
  try {
    bindings = (JSON.parse(response.body) as { results: { bindings: ReadonlyArray<Binding> } }).results.bindings
  } catch {
    return { rows: [], rater: { ...base, obtained: "unavailable", note: "WDQS answered unusably." } }
  }

  // One row per item; several bindings per item when an OPTIONAL multiplies.
  const byItem = new Map<string, {
    domains: Set<string>
    article?: string | undefined
    matchedName?: string | undefined
    alignment?: string | undefined
    founded?: string | undefined
    owner?: string | undefined
    country?: string | undefined
  }>()

  for (const binding of bindings) {
    const item = binding["item"]?.value
    if (item === undefined) continue
    const existing = byItem.get(item) ?? { domains: new Set<string>() }
    const host = hostOf(binding["website"]?.value ?? "")
    if (host !== undefined) existing.domains.add(host)
    existing.article ??= binding["article"]?.value?.replace("https://en.wikipedia.org/wiki/", "")
    existing.matchedName ??= binding["matchedName"]?.value
    existing.alignment ??= realLabel(binding["alignmentLabel"]?.value)
    existing.founded ??= binding["inception"]?.value?.slice(0, 4)
    existing.owner ??= realLabel(binding["ownerLabel"]?.value)
    existing.country ??= realLabel(binding["countryLabel"]?.value)
    byItem.set(item, existing)
  }

  const rows: Array<WikidataRow> = []
  for (const [item, value] of byItem) {
    rows.push({
      item,
      domains: [...value.domains],
      article: value.article === undefined ? undefined : decodeURIComponent(value.article),
      matchedName: value.matchedName,
      alignment: value.alignment,
      founded: value.founded,
      owner: value.owner,
      country: value.country
    })
  }

  return { rows, rater: { ...base, entries: rows.length, note: `One SPARQL query, scoped to the ${articles.length} Wikipedia articles and ${names.length} outlet names the other layers name.` } }
}

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

/**
 * Outlet name → domain, by hand, for the outlets the two automatic passes miss.
 *
 * Kept deliberately short and deliberately obvious. Every line is an outlet a
 * reader is likely to meet, whose domain is not in dispute, and which neither
 * the enwiki-article pass nor the label pass resolved. It is a patch on a join,
 * not a rating of anything: nothing here decides what AllSides *said*, only
 * which address AllSides said it about. Guessing a domain wrongly would put
 * somebody else's rating on an innocent publisher, so an outlet whose domain is
 * not certain stays out and is reported as unjoined instead.
 */
const OVERRIDES: Record<string, string> = {
  "ABC News": "abcnews.go.com",
  "Al Jazeera": "aljazeera.com",
  "AlterNet": "alternet.org",
  "Associated Press": "apnews.com",
  "Axios": "axios.com",
  "BBC News": "bbc.co.uk",
  "Bloomberg": "bloomberg.com",
  "Breitbart News": "breitbart.com",
  "Business Insider": "businessinsider.com",
  "BuzzFeed News": "buzzfeednews.com",
  "CBS News": "cbsnews.com",
  "CNS News": "cnsnews.com",
  "CNSNews.com": "cnsnews.com",
  "City Journal": "city-journal.org",
  "FAIR": "fair.org",
  "Fair.org": "fair.org",
  "Fiscal Times": "thefiscaltimes.com",
  "KQED": "kqed.org",
  "KSL": "ksl.com",
  "Louisville Courier-Journal": "courier-journal.com",
  "Manhattan Institute": "manhattan-institute.org",
  "MichelleMalkin.com": "michellemalkin.com",
  "PBS NewsHour": "pbs.org",
  "Prager University": "prageru.com",
  "Quartz": "qz.com",
  "RAND Corporation": "rand.org",
  "Right Wing News": "rightwingnews.com",
  "Salon": "salon.com",
  "Socialist Alternative": "socialistalternative.org",
  "Splinter": "splinternews.com",
  "Spokesman Review": "spokesman.com",
  "The Fulcrum": "thefulcrum.us",
  "The Independent": "independent.co.uk",
  "The Libertarian Republic": "thelibertarianrepublic.com",
  "The Resurgent": "theresurgent.com",
  "TheBlaze.com": "theblaze.com",
  "TruthOut": "truthout.org",
  "VT Digger": "vtdigger.org",
  "Vice": "vice.com",
  "WND.com": "wnd.com",
  "Washington Free Beacon": "freebeacon.com",
  "Watchdog.org": "watchdog.org",
  "Western Journalism": "westernjournal.com",
  "Whatfinger News": "whatfinger.com",
  "Yahoo! News": "news.yahoo.com",
  "Yes! Magazine": "yesmagazine.org",
  "CNBC": "cnbc.com",
  "CNN": "cnn.com",
  "CNN (Web News)": "cnn.com",
  "Daily Beast": "thedailybeast.com",
  "Daily Caller": "dailycaller.com",
  "Daily Kos": "dailykos.com",
  "Daily Mail": "dailymail.co.uk",
  "Daily Signal": "dailysignal.com",
  "Daily Wire": "dailywire.com",
  "Financial Times": "ft.com",
  "Forbes": "forbes.com",
  "Fox News": "foxnews.com",
  "FreeSpeech TV": "freespeech.org",
  "HuffPost": "huffpost.com",
  "InfoWars": "infowars.com",
  "Mother Jones": "motherjones.com",
  "MSNBC": "msnbc.com",
  "National Review": "nationalreview.com",
  "NBC News": "nbcnews.com",
  "New York Post": "nypost.com",
  "NPR (Online News)": "npr.org",
  "Newsmax": "newsmax.com",
  "OAN": "oann.com",
  "Politico": "politico.com",
  "ProPublica": "propublica.org",
  "Reason": "reason.com",
  "Reuters": "reuters.com",
  "Slate": "slate.com",
  "The Atlantic": "theatlantic.com",
  "The Economist": "economist.com",
  "The Epoch Times": "theepochtimes.com",
  "The Federalist": "thefederalist.com",
  "The Gateway Pundit": "thegatewaypundit.com",
  "The Guardian": "theguardian.com",
  "The Hill": "thehill.com",
  "The Intercept": "theintercept.com",
  "The Nation": "thenation.com",
  "The New York Times": "nytimes.com",
  "The New Yorker": "newyorker.com",
  "The Telegraph": "telegraph.co.uk",
  "The Verge": "theverge.com",
  "The Wall Street Journal": "wsj.com",
  "The Washington Post": "washingtonpost.com",
  "The Washington Times": "washingtontimes.com",
  "TheBlaze": "theblaze.com",
  "Time Magazine": "time.com",
  "Townhall": "townhall.com",
  "USA TODAY": "usatoday.com",
  "Vanity Fair": "vanityfair.com",
  "Vox": "vox.com",
  "Wired": "wired.com",
  "Yahoo News": "news.yahoo.com"
}

/**
 * Wikipedia's row heading, reduced to something a panel can print.
 *
 * The list's Source column is not a name — it is a heading for a *discussion*.
 * "Fox News[aa] (news excluding politics and science)" and "The Guardian
 * (TheGuardian.com, The Manchester Guardian, The Guardian Weekly, The Observer)"
 * are both correct as headings and both wrong as the caption over a rating. The
 * footnote markers go unconditionally; a trailing parenthetical goes only when
 * it is a list or a scope note, so that a genuine disambiguator — "ABC News
 * (USA)" — survives.
 */
const cleanRowHeading = (heading: string | undefined): string | undefined => {
  if (heading === undefined) return undefined
  const withoutFootnotes = heading.replace(/\[[a-z]{1,3}\]/g, "").trim()
  const parenthetical = withoutFootnotes.match(/^(.*?)\s*\(([^()]*)\)\s*$/)
  if (parenthetical === null) return withoutFootnotes
  const head = (parenthetical[1] ?? "").trim()
  const inside = parenthetical[2] ?? ""
  if (head.length === 0) return withoutFootnotes
  return inside.includes(",") || inside.length > 12 ? head : withoutFootnotes
}

/** True when the name says nothing the key did not already say. */
const isJustTheDomain = (name: string, domain: string): boolean => {
  const flatten = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "")
  return flatten(name) === flatten(domain) || flatten(name) === flatten(domain.replace(/\.[a-z.]+$/, ""))
}

const main = async (): Promise<void> => {
  process.stdout.write("Standing: compiling from four published datasets.\n\n")

  const rsp = await fetchWikipediaRsp()
  process.stdout.write(`  wikipedia-rsp  ${rsp.rater.obtained.padEnd(11)} ${rsp.rows.length} sources\n`)

  const iffy = await fetchIffy()
  process.stdout.write(`  iffy           ${iffy.rater.obtained.padEnd(11)} ${iffy.rows.length} domains\n`)

  const allsides = await fetchAllSides()
  process.stdout.write(`  allsides       ${allsides.rater.obtained.padEnd(11)} ${allsides.rows.length} outlets\n`)

  // The Wikidata query is scoped by what the other layers named, so it goes last.
  const articles = new Set<string>()
  for (const row of rsp.rows) for (const article of row.articles) articles.add(article)
  for (const row of allsides.rows) if (row.article !== undefined) articles.add(row.article)
  const names = allsides.rows.map((row) => row.name)

  const wikidata = await fetchWikidata([...articles], names)
  process.stdout.write(`  wikidata       ${wikidata.rater.obtained.padEnd(11)} ${wikidata.rows.length} items\n\n`)

  // --- the AllSides name → domain join -------------------------------------

  const byArticle = new Map<string, WikidataRow>()
  const byName = new Map<string, WikidataRow | "ambiguous">()
  for (const row of wikidata.rows) {
    if (row.article !== undefined && !byArticle.has(row.article)) byArticle.set(row.article, row)
    if (row.matchedName !== undefined) {
      byName.set(row.matchedName, byName.has(row.matchedName) ? "ambiguous" : row)
    }
  }

  const working = new Map<string, Working>()
  const workingFor = (domain: string): Working => {
    const existing = working.get(domain)
    if (existing !== undefined) return existing
    const created: Working = {
      rspStatuses: new Set(),
      allsidesRatings: new Set(),
      allsidesClaimants: new Set(),
      names: {}
    }
    working.set(domain, created)
    return created
  }

  // Wikipedia's list first: it is the layer whose domains are least disputable.
  let rspDomains = 0
  for (const row of rsp.rows) {
    for (const domain of row.domains) {
      const entry = workingFor(domain)
      entry.rspStatuses.add(row.status)
      entry.names.rsp ??= row.name
      rspDomains++
    }
  }

  let iffyDomains = 0
  for (const row of iffy.rows) {
    const entry = workingFor(row.domain)
    entry.iffy = row.factual
    if (row.name.length > 0) entry.names.iffy ??= row.name
    iffyDomains++
  }

  let allsidesJoined = 0
  const unjoined: Array<string> = []
  for (const row of allsides.rows) {
    // Both the row's own name and the name with its section suffix trimmed are
    // tried, because "New York Times - News" is what the mirror calls the row
    // and "New York Times" is what every other index calls the publication.
    const bare = stripSectionSuffix(row.name)
    const override = OVERRIDES[row.name] ?? OVERRIDES[bare]
    const viaArticle = row.article === undefined ? undefined : byArticle.get(row.article)
    const viaName = byName.get(row.name) ?? byName.get(bare)
    const wd = viaArticle ?? (viaName === "ambiguous" ? undefined : viaName)
    const domains = override !== undefined ? [override] : (wd?.domains ?? [])
    if (domains.length === 0) {
      unjoined.push(row.name)
      continue
    }
    for (const domain of domains) {
      const entry = workingFor(domain)
      entry.allsidesRatings.add(row.rating)
      entry.allsidesClaimants.add(bare)
      if (override !== undefined) entry.allsidesByHand = true
      entry.names.allsides ??= bare
    }
    allsidesJoined++
  }

  // Wikidata's own claims, kept only where some rater has already spoken. A
  // founding date on a publisher nobody rated is 40 bytes the panel never shows.
  let wikidataAttached = 0
  for (const row of wikidata.rows) {
    for (const domain of row.domains) {
      const entry = working.get(domain)
      if (entry === undefined) continue
      const facts: NonNullable<Entry["wikidata"]> = {}
      if (row.alignment !== undefined) facts.alignment = row.alignment
      if (row.founded !== undefined) facts.founded = row.founded
      if (row.owner !== undefined) facts.owner = row.owner
      if (row.country !== undefined) facts.country = row.country
      if (Object.keys(facts).length === 0) continue
      entry.wikidata = facts
      wikidataAttached++
    }
  }

  // --- deciding what to write ----------------------------------------------

  const publishers: Record<string, Entry> = {}
  let rspContested = 0
  let allsidesContested = 0
  let allsidesMisjoined = 0
  const contested: Array<string> = []
  const misjoined: Array<string> = []

  for (const domain of [...working.keys()].sort()) {
    const found = working.get(domain)
    if (found === undefined) continue
    const entry: Entry = {}

    /**
     * A domain Wikipedia's list rates two different ways gets NO reliability
     * claim, and the disagreement is reported rather than resolved.
     *
     * `foxnews.com` is the case that forces this: the list holds one row for
     * Fox News on politics and science and another for everything else, with
     * different statuses. Any single word we picked would be an adjudication —
     * choosing the harsher one is us calling the publisher unreliable, choosing
     * the kinder one is us clearing it, and "no consensus" is a status
     * Wikipedia did not assign. ADR 0006 says we report rather than adjudicate,
     * so the honest output is silence about reliability while the other layers
     * still speak. It costs a real claim on a well-known publisher; it is the
     * direction this codebase's failures always fall.
     */
    const statuses = [...found.rspStatuses]
    const onlyStatus = statuses[0]
    if (statuses.length === 1 && onlyStatus !== undefined) entry.wikipediaRsp = onlyStatus
    else if (statuses.length > 1) {
      rspContested++
      if (contested.length < 20) contested.push(`${domain} — Wikipedia (${statuses.join(", ")})`)
    }

    // Same rule, same reason, for AllSides: two rows landing on one domain with
    // two different leans is a disagreement we are not entitled to settle.
    const ratings = [...found.allsidesRatings]
    const claimants = [...found.allsidesClaimants]
    const onlyRating = ratings[0]
    if (found.allsidesByHand !== true && claimants.length > 1) {
      // Not a disagreement — a bad join. Several unrelated outlets cannot share
      // one official website, so the domain is an archive, a registry or a host
      // that a Wikidata `P856` happens to point at. Dropped silently from the
      // ratings and counted, because reporting it as "contested" would dignify
      // it as a difference of opinion.
      allsidesMisjoined++
      if (misjoined.length < 12) misjoined.push(`${domain} ← ${claimants.join(", ")}`)
    } else if (ratings.length === 1 && onlyRating !== undefined) entry.allsides = onlyRating
    else if (ratings.length > 1) {
      allsidesContested++
      if (contested.length < 20) contested.push(`${domain} — AllSides (${ratings.join(", ")})`)
    }

    if (found.iffy !== undefined) entry.iffy = found.iffy
    if (found.wikidata !== undefined) entry.wikidata = found.wikidata
    if (Object.keys(entry).length === 0) continue

    // Whose spelling of the publisher's name the reader sees. AllSides and Iffy
    // write a name; Wikipedia's list writes a row heading, complete with
    // footnote markers and a parenthetical list of every masthead the row
    // covers. So the row heading is the last resort and is cleaned first.
    let name = found.names.allsides ?? found.names.iffy ?? cleanRowHeading(found.names.rsp)
    // Where another layer spells the same name more completely — "Fox" from
    // AllSides' "Fox Online News" against "Fox News" from Wikipedia's list —
    // the fuller spelling wins. Only a strict extension counts, so this can
    // lengthen a name but never swap it for a different publisher's.
    if (name !== undefined) {
      for (const other of [found.names.allsides, found.names.iffy, cleanRowHeading(found.names.rsp)]) {
        if (other === undefined || name === undefined) continue
        if (other.length > name.length && other.toLowerCase().startsWith(`${name.toLowerCase()} `)) name = other
      }
    }
    // A name that only repeats the domain earns nothing and costs bytes.
    if (name !== undefined && !isJustTheDomain(name, domain)) entry.name = name

    publishers[domain] = entry
  }

  const artifact = {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    raters: {
      allsides: allsides.rater,
      "wikipedia-rsp": rsp.rater,
      iffy: iffy.rater,
      wikidata: wikidata.rater
    },
    publishers
  }

  const json = `${JSON.stringify(artifact, null, 0)}\n`

  process.stdout.write("Joined:\n")
  process.stdout.write(`  wikipedia-rsp  ${rspDomains} domain claims, ${rspContested} domains dropped as contested\n`)
  process.stdout.write(`  iffy           ${iffyDomains} domain claims\n`)
  process.stdout.write(`  allsides       ${allsidesJoined}/${allsides.rows.length} outlets joined, ${allsidesContested} contested + ${allsidesMisjoined} misjoined domains dropped\n`)
  process.stdout.write(`  wikidata       ${wikidataAttached} publishers carry facts\n`)
  process.stdout.write(`  publishers     ${Object.keys(publishers).length}\n`)
  process.stdout.write(`  size           ${(json.length / 1024).toFixed(1)} KB raw\n\n`)

  if (misjoined.length > 0) {
    process.stdout.write(`Domains several unrelated AllSides outlets resolved to — dropped as bad joins:\n`)
    process.stdout.write(`${misjoined.map((line) => `  ${line}`).join("\n")}\n\n`)
  }

  if (contested.length > 0) {
    process.stdout.write("Wikipedia rates these domains more than one way, so no reliability claim is written:\n")
    process.stdout.write(`${contested.map((line) => `  ${line}`).join("\n")}\n\n`)
  }

  if (unjoined.length > 0) {
    process.stdout.write(`AllSides outlets with no domain (${unjoined.length}) — candidates for OVERRIDES:\n`)
    process.stdout.write(`${unjoined.map((n) => `  ${n}`).join("\n")}\n\n`)
  }

  if (DRY_RUN) {
    process.stdout.write("--dry-run: nothing written.\n")
    return
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, json)
  process.stdout.write(`Wrote ${OUT}\n`)
}

await main()
