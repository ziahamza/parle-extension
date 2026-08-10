/**
 * The front-door sweep's corpus: every address it visits and what each one is
 * expected to do. DATA ONLY — no logic lives here, so the corpus can grow
 * without touching either runner (`frontdoor.e2e.ts` sequential,
 * `sweep.e2e.ts` sharded). Both consume exactly this file.
 *
 * The judgements ("shows" / "folds" / "quiet") and what they mean are defined
 * in `frontdoor.lib.ts`; the reasons behind each list are unchanged from the
 * original sweep and kept with the lists.
 */

export type Expected = "shows" | "folds" | "quiet"

/**
 * Links off a Network's own front page, scraped at run time — these are the
 * pages the product is for, and every one that loses its mark is a real
 * regression. One link per host, because twelve nytimes.com articles measure
 * one publisher and the sweep is about breadth.
 */
export const HN_FRONT = {
  address: "https://news.ycombinator.com/",
  selector: "span.titleline > a",
  want: 27,
  expected: "shows" as Expected,
  /** Hosts never taken from the scrape: the Networks themselves. */
  skipHosts: ["ycombinator.com", "reddit.com"]
} as const

/**
 * The Network whose refusal is itself under test. Reddit answers this network
 * with a 403 on every surface, and that must render as a refusal — never as
 * "nobody has discussed this page".
 */
export const REDDIT_NETWORK = "https://old.reddit.com/r/programming/"

/**
 * Pages of the kind r/programming and r/technology submit. Hand-picked rather
 * than scraped, because Reddit's 403 means its front page cannot be followed
 * from here.
 */
export const REDDIT_SHAPED: ReadonlyArray<string> = [
  "https://blog.rust-lang.org/2024/09/05/Rust-1.81.0.html",
  "https://go.dev/blog/go1.22",
  "https://sqlite.org/whybytecode.html",
  "https://www.postgresql.org/about/news/postgresql-17-released-2936/",
  "https://arstechnica.com/gadgets/2024/07/a-new-linux-kernel-release/",
  "https://www.theguardian.com/technology/2024/jul/19/crowdstrike-outage",
  "https://research.swtch.com/coro",
  "https://jvns.ca/blog/2023/09/19/when-your-coworker-does-great-work/"
]

/**
 * Front doors and other pages that should show nothing, chosen to cover every
 * shape the objection named. Banks and mail are on the Exclusion List, so they
 * are expected quiet for a reason that has nothing to do with the front-door
 * rule — the report tells the two apart so the reader does not have to.
 */
export const QUIET: ReadonlyArray<string> = [
  "https://facebook.com/",
  "https://bankofamerica.com/",
  "https://google.com/",
  "https://github.com/",
  "https://nytimes.com/",
  "https://netflix.com/",
  "https://gitlab.com/",
  "https://wellsfargo.com/",
  "https://stackoverflow.com/",
  "https://python.org/",
  "https://amazon.com/",
  "https://apple.com/",
  "https://microsoft.com/",
  "https://cloudflare.com/",
  "https://openai.com/",
  "https://npr.org/",
  "https://theverge.com/",
  "https://bbc.co.uk/",
  "https://linkedin.com/",
  "https://instagram.com/",
  "https://chase.com/",
  "https://mail.google.com/",
  "https://calendar.google.com/",
  "https://docs.google.com/",
  "https://accounts.google.com/",
  "https://en.wikipedia.org/",
  "https://archive.org/",
  "https://stripe.com/pricing",
  "https://openai.com/pricing",
  "https://github.com/login",
  "https://doc.rust-lang.org/book/",
  "https://nytimes.com/section/technology",
  "https://reddit.com/r/programming",
  "https://news.ycombinator.com/newest",
  // Where five of the redirecting front doors above actually land, so the rule
  // is measured on the page the reader ends up looking at rather than on the
  // address they typed.
  "https://en.wikipedia.org/wiki/Main_Page",
  "https://www.microsoft.com/en-us",
  "https://about.gitlab.com/",
  "https://stackoverflow.com/questions",
  "https://www.netflix.com/browse"
]

/**
 * The pages the rule must never touch. The last two are rootish, and the two
 * the threshold's margin is thinnest against: 0.653 and 0.400 against a 0.35
 * threshold, measured live.
 */
export const CLASSICS: ReadonlyArray<string> = [
  "https://paulgraham.com/greatwork.html",
  "https://paulgraham.com/ds.html",
  "https://paulgraham.com/genius.html",
  "https://danluu.com/empirical-pl/",
  "https://danluu.com/everything-is-broken/",
  "https://grugbrain.dev/",
  "https://sicpdistilled.com/"
]

/**
 * Pages with a mark on them, used only to open the panel with a real gesture.
 * More than one because the gesture does not always take on the first heavy
 * page — measured: nature.com fails about half the time, paulgraham.com never
 * does.
 */
export const OPENERS: ReadonlyArray<string> = [
  "https://paulgraham.com/greatwork.html",
  "https://www.nature.com/articles/d41586-024-02012-5"
]

/**
 * Screenshots of the states the objection is about, as drawn. Wikipedia first:
 * it is the address ADR 0019 is about — it redirects to `/wiki/Main_Page`, so
 * the fold there is drawn from an Alias rather than from the elected Subject
 * URL, and if that shot ever shows eleven rows again, `traversed` stopped
 * arriving.
 */
export const SHOTS: ReadonlyArray<readonly [name: string, url: string]> = [
  ["front-door-wikipedia", "https://en.wikipedia.org/"],
  ["front-door-github", "https://github.com/"],
  ["front-door-cloudflare", "https://cloudflare.com/"],
  ["front-door-bankofamerica", "https://bankofamerica.com/"],
  ["front-door-facebook", "https://facebook.com/"],
  ["classic-greatwork", "https://paulgraham.com/greatwork.html"],
  ["classic-grugbrain", "https://grugbrain.dev/"]
]
