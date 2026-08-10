/**
 * Telling a site's front door from a document that lives on it.
 *
 * `bankofamerica.com` is an organisation people discuss forever; a Bank of
 * America blog post is one thing people discussed once. Both accumulate
 * submissions to Hacker News, and today the panel draws them identically — so a
 * reader who opens `google.com` gets 148 rows about 148 unrelated events, and
 * gives up on the panel before they ever reach a page it would have helped on.
 *
 * ## The signal is NOT time spread, and that was measured
 *
 * The obvious rule — an everlasting page's Discussions are scattered across all
 * history, a real item's cluster around publication — is wrong, and wrong in the
 * most expensive direction. Measured over 732 pages with at least one
 * submission (591 positive, of which 57 are hand-labelled classics; 141
 * negative):
 *
 * ```
 *   span >= 365d    suppresses 75.9% of front doors   and 98.2% of the classics
 *   span >= 1825d   suppresses 46.1%                  and 77.2%
 *   span >= 3650d   suppresses 26.2%                  and 49.1%
 * ```
 *
 * Precision sits at 53–58% at *every* threshold: it is not a weak signal, it
 * carries no information here. `paulgraham.com/greatwork.html` is resubmitted
 * over years and every submission is genuinely about that essay; classics span
 * LONGER than generic roots, not shorter. A time-spread rule silences exactly
 * the pages most worth showing. It is not in this module, and the ablation is
 * recorded in ADR 0017 so that re-adding it means deleting a decision.
 *
 * Publication date, `og:type`, burstiness and traction concentration were
 * measured too, and each silences between 32% and 78% of genuine positives.
 * None of them are here either.
 *
 * ## What is here, and why it takes two signals
 *
 * **Path shape.** A front door is a root address. This is the strong signal and
 * also the honest one: its cost is that 5.9% of real positives are rootish —
 * Show HN launches where the homepage IS the item, plus two classics
 * (`grugbrain.dev`, `sicpdistilled.com`). Alone it silences them.
 *
 * **Title divergence.** Five submissions of `bankofamerica.com` carry five
 * DIFFERENT titles — "BoA down", "BoA sues X", "BoA changes policy" — because
 * they are about five different events at an organisation. Five submissions of
 * an essay carry the SAME title, because they are about one document. Alone
 * this fails on `danluu.com`, whose essays get retitled by submitters
 * (`empirical-pl`: mean Jaccard 0.246 over 17 submissions).
 *
 * The two are complementary in exactly the right way, which is the whole reason
 * both are required. Root-scoping neutralises danluu.com — a deep path is never
 * judged at all. Title agreement neutralises the Show HN homepage — one title,
 * repeated. Ablated, on the same corpus:
 *
 * ```
 *   full rule                68.8% of front doors hidden,  0 positives,  0 classics
 *   − root scoping           78.0%                         1.9%          3 classics
 *   − title agreement        79.4%                         0.5%          1 classic
 *   − incident clause        63.8%                         0             0
 *   + span >= 365d           62.4%                         0             0   (pure loss)
 * ```
 *
 * Nothing in this module deletes a Discussion. It marks a Subject, and the
 * panel folds that Subject's *stale* Discussions behind one disclosed, counted,
 * one-click line. ADR 0005's rule is that a mechanism which silently hides
 * Discussions is worse than one that costs requests, because a false negative
 * is invisible to the reader — so the thin margins measured here are survivable
 * only because a mistake costs one click rather than a disappearance.
 */

/**
 * One submission of an address to a Network — the two fields the rule reads.
 *
 * Deliberately not a `Discussion`: this module is pure policy over titles and
 * timestamps, and taking the connector's record would drag `@parle/networks`
 * into a decision that needs two strings.
 *
 * `postedAt` is epoch milliseconds, and nullable for the same reason
 * `Discussion.postedAt` is — Algolia omits `created_at_i` on some hits, and
 * old.reddit renders a relative time. A submission with no date is never
 * treated as fresh; see {@link freshCount}.
 */
export interface Submission {
  readonly title: string
  readonly postedAt: number | null
}

/**
 * Single path segments that are still the front door.
 *
 * Chosen over the tempting `depth <= 1`, which costs 27.6% of real positives —
 * every `example.com/blog-post` on a flat site. These are locale roots and
 * index files and nothing else.
 *
 * Deliberately NOT extended to generic path words (`/login`, `/pricing`,
 * `/newest`, `/careers`), and the reason is now measured properly rather than
 * inherited. ADR 0017 recorded the cost as `up.codes/careers`, a real page with
 * 22 submissions — **that no longer reproduces.** Its titles are all "UpCodes
 * (YC S17) is hiring …" and they agree at 0.452, well clear of
 * {@link DISAGREEMENT}; live it returns zero exact hits. The recorded
 * counterexample was stale.
 *
 * The widening is still refused, on Hacker News' own url index: every address
 * of the shape `host/<entrance word>` anyone has submitted, 616 of them across
 * 30 words, run through the title half below. It folds **39**, of which **22**
 * are front doors and **17 are real pages** — 56% precision, and roughly 2,600
 * points of real pages against 1,400 of front doors. **It folds more of what
 * readers came for than of what they did not.**
 *
 * The failure is structural, not a bad word: a small product's Show HN is
 * submitted with the URL of its login page, its docs or its FAQ, several times,
 * with a different title each time — which is exactly what the title half reads
 * as disagreement. `kayak.com/explore` (668 points), `boringcompany.com/faq`
 * (624), `subreply.com/trending` (447), `suno.com/explore` (390) and
 * `hellosystem.github.io/docs` (319) are all silenced; the loudest thing gained
 * is `openai.com/pricing` at 192. Narrowing to the four auth words still scores
 * 10 gains against 8 costs, and guarding on a `Show HN:` prefix loses
 * `github.com/login`, which is the miss the widening existed to catch.
 *
 * So `github.com/login`, `openai.com/pricing` and
 * `nytimes.com/section/technology` keep showing their Discussions. That is a
 * decision with a price on it, recorded in ADR 0019.
 */
const ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  "en",
  "en-us",
  "en-gb",
  "us",
  "uk",
  "home",
  "index",
  "index.html",
  "index.htm",
  "main",
  "start",
  "welcome",
  "homepage",
  "default.aspx"
])

/**
 * Whether an address is a site's entrance rather than a document on it.
 *
 * A query string does not save it: `example.com/?ref=hn` is still the front
 * page, and `example.com/?p=1234` — a WordPress permalink — is not, which is
 * why a non-empty query on a root path is treated as a document. That case is
 * rare and the bias runs toward *showing*, which is the direction ADR 0005
 * requires every uncertainty in this module to run.
 */
export const isRootish = (address: string): boolean => {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return false
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  // A WordPress-style `?p=1234` is a document living at the root path. Anything
  // with a query is given the benefit of the doubt.
  if (url.search !== "") return false
  const segments = url.pathname.split("/").filter((s) => s.length > 0)
  if (segments.length === 0) return true
  if (segments.length > 1) return false
  const only = segments[0]
  return only !== undefined && ROOT_SEGMENTS.has(only.toLowerCase())
}

/**
 * Whether ANY address believed to point at this Subject is a site's entrance.
 *
 * `en.wikipedia.org/` redirects to `/wiki/Main_Page`. Judging only the elected
 * Subject URL, that is a two-segment path, so the rule never looks at it — and
 * the panel draws eleven rows including "Wikipedia Is Down?" and "Wikipedia is
 * blacked out" on the encyclopedia's front page. It was the worst miss in the
 * 82-page sweep.
 *
 * The pre-redirect address WAS rootish, and we know it the same way ADR 0015
 * lets us know anything about identity: **the reader's own browser traversed
 * the redirect.** That is one of the three kinds of evidence `AliasEvidence`
 * admits, alongside our own canonicalization and a Network's submitted URL, and
 * pointedly not a page's self-declared `rel=canonical` — a site cannot make
 * itself un-judgeable by asserting a deep canonical, because nothing it says
 * about itself reaches here.
 *
 * **Measured, because widening what can be judged is the dangerous direction.**
 * Every one of the 732 corpus pages with a submission was fetched following
 * redirects; 57 land somewhere else and 14 of those turn a rootish address into
 * a deep one. All 14 are front doors — locale roots (`uber.com/fi/en/`,
 * `stripe.com/en-fi`, `netflix.com/fi/`, `robinhood.com/eu/en/`), sections
 * (`stackoverflow.com/questions`, `theguardian.com/europe`), consent walls and
 * sign-in flows. **Zero positives and zero classics** change judgeability.
 *
 * The adversarial case — a site whose root redirects onto one of its own real
 * documents, which is the only way this can silence a page worth reading — was
 * probed directly: the roots of all 353 hosts in the corpus that carry a
 * genuine deep-path positive. 13 redirect to a non-rootish address and **none
 * of them lands on that site's own document**; every one lands on another front
 * door (`/projects/`, `/dashboard`, `/home.aspx`, `/3/`, `/en-EU`,
 * `/wiki/Main_Page`).
 *
 * The recall it buys today is one page, and honestly it is one page: of those
 * 14, thirteen have no submissions at the destination at all, so there is
 * nothing to fold. That is the retrieval gap recorded in ADR 0017, not this
 * rule — and when retrieval is fixed those thirteen become folds this handles
 * and the elected-URL-only rule cannot.
 */
export const anyRootish = (addresses: ReadonlyArray<string>): boolean => addresses.some(isRootish)

/**
 * Words that carry no information about WHICH event a title is describing.
 *
 * Kept small and generic. A stoplist that grew domain words — "outage",
 * "launch", "down" — would erase the very difference this measures, because
 * those are exactly the words that differ between two events at one
 * organisation.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "did", "do", "does", "for", "from", "get", "gets", "had", "has", "have",
  "how", "i", "if", "in", "into", "is", "it", "its", "just", "may", "might",
  "more", "most", "new", "no", "not", "now", "of", "on", "one", "or", "our",
  "out", "over", "s", "so", "some", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "to", "up", "us", "use", "used",
  "using", "via", "was", "we", "were", "what", "when", "which", "who", "why",
  "will", "with", "would", "you", "your"
])

/** `Show HN:`, `Ask HN:`, `Tell HN:`, `Launch HN:` — the convention, not the subject. */
const HN_PREFIX = /^\s*(show|ask|tell|launch)\s+hn\s*:\s*/i

/**
 * The two prefixes that mean "I built this, and this address IS it".
 *
 * A narrower set than {@link HN_PREFIX} on purpose. `Ask HN` and `Tell HN` are
 * about the poster's question or news — "Tell HN: GitHub Apps – Private key is
 * not private" points at `github.com/login` and is a submission about an
 * organisation, not a thing somebody shipped. Only `Show` and `Launch` carry the
 * claim {@link builtHere} rests on.
 */
const BUILT_HERE = /^\s*(show|launch)\s+hn\s*:\s*/i

/**
 * Whether somebody submitted this address saying they built the thing at it.
 *
 * **This is the correction the widened evidence forced.** ADR 0017 shipped with
 * the honest admission that its safety evidence was thin exactly here — "the
 * rule can only touch the rootish real pages in the corpus — 35 of 591 — of
 * which 27 have a single submission. Seeding 150+ Show HN homepage launches and
 * re-running is the highest-value follow-up." Seeded thirteen times over:
 * **1,959 Show HN and Launch HN submissions whose URL is a bare root**, sampled
 * evenly per half-year from 2016 to 2026 and re-queried through the connector's
 * own query. 1,244 are old enough for the fold to reach, so the thirty-day
 * horizon does not protect this sample.
 *
 * The rule as shipped called **322 of them (16.4%) a front door** and would have
 * folded away **every row of 235 of them (12.0%)** — one Show HN homepage launch
 * in eight — including `gitdiagram.com` (222 points), `tabserve.dev` (117) and
 * `pickcode.io` (86). The mechanism is not exotic: **a founder resubmits their
 * own homepage over a year with a different pitch each time** — "Show HN:
 * Instantly visualize any codebase as an interactive diagram", then "Show HN:
 * Instantly understand any GitHub repo" — and low title agreement
 * is exactly what that produces. It is the false negative ADR 0005 calls the
 * expensive kind, on the pages a reader most wants the panel to work on.
 *
 * With this guard: **3 of 1,959**, at 9, 9 and 5 points, two of them genuinely
 * shutting-down news caught by the incident clause. The cost is 3.5 points of
 * recall on the corpus — 73.0% to 69.5% on full retrieval, 49.3% to 46.3% live —
 * and no change at all to positives (0.7%) or classics (0/57). The five it stops
 * folding are `netlify.com`, `squareup.com`, `railway.app`, `fly.io` and
 * `obsidian.md` — every one of them a company whose homepage *was* a Show HN,
 * which is to say
 * the recall it gives up was never front doors. `obsidian.md` is one of the five
 * product landings ADR 0017 recorded as a known cost; this removes it.
 *
 * **Order matters and is load-bearing.** {@link anyIncident} is consulted before
 * this, and is not weakened by it, so a `Show HN` submission pointed at
 * `github.com` cannot buy that site out of the fold — "GitHub is down" still
 * decides. This guard can only ever cause MORE Discussions to be shown, which is
 * the direction ADR 0005 requires an uncertainty in this module to run.
 *
 * **It can be gamed, and that is acceptable.** Anyone may submit "Show HN: …"
 * pointed at any homepage and take that address out of the title half. What they
 * win is a NOISIER panel on that site, because the fold is what makes a front
 * door quiet — and the incident clause, which catches the loudest front doors,
 * is not reachable this way at all.
 */
export const builtHere = (submissions: ReadonlyArray<Submission>): boolean =>
  submissions.some((s) => BUILT_HERE.test(s.title))

/**
 * Hacker News' own resubmission convention: a trailing `(2013)`.
 *
 * Stripping it is what keeps "Reflections on Trusting Trust" and "Reflections
 * on Trusting Trust (1984)" one title rather than two. Without this the classic
 * essays — the exact pages this rule must never touch — score as divergent.
 */
const YEAR_SUFFIX = /\s*\((19|20)\d{2}\)\s*$/
const FORMAT_TAG = /\[(pdf|video|audio|slides|paper|book|html|scanned)\]/gi

/**
 * A title reduced to the set of words that say what it is about.
 *
 * Exported because the normalisation is the interesting half of the rule and a
 * test that cannot see it can only assert on the number that comes out.
 */
export const titleWords = (title: string): ReadonlySet<string> => {
  const flattened = title
    .toLowerCase()
    .replace(HN_PREFIX, "")
    .replace(YEAR_SUFFIX, "")
    .replace(FORMAT_TAG, " ")
  const words = flattened.split(/[^a-z0-9]+/).filter((w) => w.length > 0 && !STOPWORDS.has(w))
  return new Set(words)
}

const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  if (a.size === 0 && b.size === 0) return 1
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  const union = a.size + b.size - shared
  return union === 0 ? 1 : shared / union
}

/**
 * How much this address's submissions agree about what the page is, 0 to 1.
 *
 * Mean over every unordered pair, not over consecutive pairs: an organisation
 * accumulates events in no order, and a consecutive-pair mean is dominated by
 * whichever two happened to arrive together.
 *
 * Returns 1 — perfect agreement, therefore never a front door — for fewer than
 * two submissions. That is the safe direction, and it is load-bearing: 27 of
 * the 35 rootish positives in the corpus have exactly one submission, and a
 * single-submission page is one nobody has said anything divergent about yet.
 *
 * **The consequence is real and is accepted rather than patched.** `openai.com/`
 * shows its one Discussion because one submission cannot disagree with itself.
 * The proposed patch — fire when the single title is essentially the site's own
 * name and says nothing about content, as `newyorker.com` / "The New Yorker"
 * does — was measured against the population ADR 0017 said this rule was least
 * evidenced on: 774 Show HN and Launch HN submissions whose URL is a bare root,
 * where the homepage genuinely IS the item. The rule as it stands folds **0 of
 * 637** of them. The patch folds **1 front door and 4 real pages**, 20%
 * precision, and one of the four is **`18words.com` at 1,160 points**, whose
 * submission is titled "Show HN: 18 Words". A product named after what it does
 * has a title that is its own name; that is what naming a product well
 * produces, and no amount of tuning separates it from a magazine's masthead.
 * ADR 0019 records the refusal.
 */
export const titleAgreement = (submissions: ReadonlyArray<Submission>): number => {
  if (submissions.length < 2) return 1
  const words = submissions.map((s) => titleWords(s.title))
  let total = 0
  let pairs = 0
  for (let i = 0; i < words.length; i += 1) {
    for (let j = i + 1; j < words.length; j += 1) {
      const a = words[i]
      const b = words[j]
      if (a === undefined || b === undefined) continue
      total += jaccard(a, b)
      pairs += 1
    }
  }
  return pairs === 0 ? 1 : total / pairs
}

/**
 * Below this, the submissions are describing different things.
 *
 * 0.35 and not 0.45 or 0.5, and the difference was measured against what the
 * connector actually returns rather than against full retrieval. On full
 * retrieval 0.35 / 0.45 / 0.5 hide 68.8% / 70.9% / 72.3% of front doors at zero
 * positive cost, so 0.5 looks free. It is not: in the live top-50 relevance
 * window `sicpdistilled.com` — a classic — collapses from five submissions to
 * two, and its agreement falls 0.526 → 0.400, because one title is a strict
 * subset of the other. Every threshold at or above 0.40 silences it live.
 *
 * 0.35 is the highest value safe in BOTH views. Margin to the nearest classic:
 * 0.176 on full retrieval, 0.050 live. The 3.5 points of extra recall that 0.5
 * buys are paid for with a silenced classic, which ADR 0005 does not permit.
 */
export const DISAGREEMENT = 0.35

/**
 * Words that mean "something happened to this organisation today".
 *
 * Six, not fourteen. The first draft of this list also had `status`, `broken`,
 * `not working`, `hacked`, `breach`, `maintenance` and `read-only`, and
 * `read-only` fired on **"Launch HN: HyperProbe (YC S26) – Agents that do
 * read-only debugging in prod"** — a genuine Launch HN, silenced by a word in
 * its own product description. Narrowing to these six plus the Show/Ask/Tell/
 * Launch HN guard below removes that defect for 0.7 points of recall on full
 * retrieval and zero points live.
 *
 * The clause is not decoration: it is what catches the product owner's own
 * example. In the live window `facebook.com` returns exactly two submissions —
 * "Facebook-owned sites were down" and "Facebook was down" — whose agreement is
 * 0.50, above threshold. `github.com` scores 1.000 with all four titles
 * "GitHub is down". Both are caught only here. Removing this clause costs 5
 * points of recall on full retrieval and roughly 22 live.
 */
const INCIDENT = /\b(down|outage|offline|502|503|504)\b/i

/**
 * Whether any submission is reporting an incident rather than a document.
 *
 * The Show/Ask/Tell/Launch HN guard is what keeps a product whose *description*
 * contains one of these words out of it. A "Show HN" is by construction a
 * submission about a thing someone built, never about that thing having fallen
 * over.
 */
export const anyIncident = (submissions: ReadonlyArray<Submission>): boolean =>
  submissions.some((s) => !HN_PREFIX.test(s.title) && INCIDENT.test(s.title))

/**
 * How old a Discussion has to be before a Front Door judgement may touch it.
 *
 * This is the whole answer to "I don't want to miss a page discussed on Hacker
 * News the moment it is discussed". It is not a TTL and not a confidence score
 * — it is a restriction on the rule's DOMAIN. A Discussion inside this horizon
 * is drawn normally whatever the verdict says, because the verdict is not
 * consulted for it. The risk is therefore structurally outside the rule rather
 * than mitigated by it.
 *
 * 30 days rather than the 7 that hides marginally more (75.9% against 72.3%),
 * and the reason is the reader rather than the metric: a Show HN launch thread
 * is still *the* conversation about that homepage a month later. The seven
 * extra rows 30 days leaks are `google.com` (4), and one each on
 * `news.ycombinator.com`, `python.org`, `theverge.com`, `obsidian.md`,
 * `archive.org` and `stackoverflow.com` — all under 6 points bar the genuinely
 * newsworthy ones.
 */
export const HORIZON_MS = 30 * 24 * 60 * 60 * 1000

/** How many of these submissions are inside the freshness horizon. */
export const freshCount = (submissions: ReadonlyArray<Submission>, now: number): number =>
  submissions.filter((s) => s.postedAt !== null && now - s.postedAt <= HORIZON_MS).length

/**
 * What the rule concluded about a Subject, and on what evidence.
 *
 * A tagged union rather than a boolean because the reason is shown to the
 * reader and reported in the toolbar's account. ADR 0005 requires anything that
 * suppresses to be visible where it fires, and "visible" means the reader can
 * read WHY, not merely that something happened.
 */
export type Verdict =
  | {
    readonly _tag: "FrontDoor"
    /**
     * `titles-disagree` — the submissions describe different things.
     * `incident` — at least one reports the organisation falling over.
     */
    readonly because: "titles-disagree" | "incident"
    /** Mean pairwise title agreement, 0 to 1. Carried for the account. */
    readonly agreement: number
  }
  | { readonly _tag: "Document" }

/** The verdict for anything the rule declines to judge. */
export const document: Verdict = { _tag: "Document" }

/**
 * Judge one Subject from its own submissions.
 *
 * Takes the **addresses** believed to point at this Subject rather than one
 * address, because that is what a Subject is: "identified by the set of
 * addresses believed to point at one reading of it". The elected Subject URL is
 * one of them and carries no privilege here — see {@link anyRootish} for the
 * page that privilege was losing.
 *
 * Total, pure, and free to re-run: its only inputs are titles and timestamps,
 * both of which are already in the Lookup answer. That is what makes the
 * remembered judgement safe to overwrite on every answer, and why it needs no
 * staleness window of its own.
 *
 * **A Subject with no submissions is never a Front Door.** There is nothing to
 * judge — a Silence is evidence that nobody discussed the page, which is the
 * opposite of evidence that the page is an entrance. Conflating the two would
 * let one quiet week on `newsite.com` mark it permanently.
 */
export const judge = (
  addresses: ReadonlyArray<string>,
  submissions: ReadonlyArray<Submission>
): Verdict => {
  if (submissions.length === 0) return document
  if (!anyRootish(addresses)) return document
  if (anyIncident(submissions)) {
    return { _tag: "FrontDoor", because: "incident", agreement: titleAgreement(submissions) }
  }
  // Somebody said they built the thing at this address, so the address is the
  // thing. Below the incident clause and never above it — see `builtHere`.
  if (builtHere(submissions)) return document
  const agreement = titleAgreement(submissions)
  if (submissions.length >= 2 && agreement <= DISAGREEMENT) {
    return { _tag: "FrontDoor", because: "titles-disagree", agreement }
  }
  return document
}

export const isFrontDoor = (verdict: Verdict): boolean => verdict._tag === "FrontDoor"

/**
 * The version of these rules, stamped onto every remembered judgement.
 *
 * Bumped whenever the thresholds, the lexicon or the root-segment list changes,
 * so that no stored judgement can outlive the code that made it. Cheap to bump,
 * because re-deriving a verdict costs nothing and needs no request.
 *
 * 2: the rule reads the Subject's Aliases, not only its elected URL, and a
 * `Show HN` / `Launch HN` submission takes an address out of the title half.
 */
export const RULES_VERSION = 2
