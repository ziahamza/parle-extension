/**
 * The page-KIND corpus: the shapes the front-door sweep has never represented.
 *
 * DATA ONLY, in the same arrangement as `frontdoor.corpus.ts`: the addresses,
 * the served fixtures and the expected behaviour live here; everything that
 * decides a verdict lives in the runner (`kinds.e2e.ts`), so the corpus can
 * grow without touching it and a sharded runner can consume exactly this file.
 *
 * The existing 82 sweep addresses are hand-picked SHAPES — front doors,
 * classics, HN-front links. The bugs left are in the shapes missing: redirect
 * chains, SPA routers, fragments, AMP mismatches, paywalls, non-Latin
 * addresses, Trusted-Types hosts, iframes, enormous answer sets, and the
 * reader's own Networks. Each scenario below is one such shape.
 *
 * **Every `expectation` was written BEFORE the scenario was first run**, from
 * the ADR it names — never adjusted afterwards to match what happened. Where
 * reality disagrees, the run records the disagreement; the expectation stays.
 *
 * Served pages (`serve`) are fulfilled by `context.route`, so they are
 * deterministic and cost no page fetch. The Lookups they trigger still go to
 * the real Algolia endpoint — that is the point of the sweep — which is why
 * the runner holds a token bucket (ADR 0014: the reader's IP is the metered
 * one, and on this box every harness shares it).
 */

/** One address the harness serves instead of fetching. */
export interface ServedPage {
  readonly address: string
  readonly status?: number
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
}

/** One thing the runner does to the tab, in order. */
export type DriveStep =
  | { readonly goto: string }
  /** A real mouse click on a selector in the page (not in any shadow root). */
  | { readonly click: string }
  | { readonly waitMs: number }
  /** Block until some Algolia query contains this fragment (or time out). */
  | { readonly awaitQueried: string }
  /** Everything before this mark is "the first burst"; see `quietAfterMark`. */
  | { readonly mark: true }

/**
 * What one scenario must produce. Every field is optional; only the named
 * assertions run, and each failed assertion is reported by name.
 */
export interface Expect {
  /** The panel's own address line must contain this before judging. */
  readonly panelOn: string
  /** Each fragment must appear inside some decoded Algolia `query`. */
  readonly queried?: ReadonlyArray<string>
  /** Some decoded ADDRESS query (`restrictSearchableAttributes=url`) must EQUAL this, byte for byte. */
  readonly queriedExactly?: ReadonlyArray<string>
  /** No decoded Algolia query may contain any of these. */
  readonly neverQueried?: ReadonlyArray<string>
  /** No decoded ADDRESS query may EQUAL any of these. */
  readonly neverQueriedExactly?: ReadonlyArray<string>
  /** The decoded title query must equal this, byte for byte. */
  readonly titleQueried?: string
  /** At most this many Algolia requests in the scenario's window. */
  readonly atMostAlgolia?: number
  /** After the `mark` drive step, no Algolia query may contain this. */
  readonly quietAfterMark?: string
  /** No Algolia request URL may contain a raw or encoded `#`. */
  readonly noFragmentInQueries?: boolean
  readonly linkedAtLeast?: number
  readonly topicalAtLeast?: number
  readonly topicalAtMost?: number
  readonly foldedAtLeast?: number
  /**
   * No Discussion rows at all — linked, folded or topical. NOT the "Nobody has
   * discussed this page" sentence: on this box Reddit answers every Lookup 403,
   * and a panel where a Network refused deliberately never says "nobody has
   * discussed" (that honesty is `panelOf.ts`'s own rule), so the sentence is
   * unreachable here and asserting it would test the wrong thing.
   */
  readonly nothingShown?: boolean
  /** The Exclusion List spoke: "on the built-in list" / "isn't looking this page up". */
  readonly excluded?: boolean
  /** A `.parle-repeat` clause exists and its count is at least this. */
  readonly repeatClauseAtLeast?: number
  /** The "…not all of them" window note must be absent. */
  readonly noWindowNote?: boolean
  /** No error-level console line or pageerror attributable to our code. */
  readonly consoleClean?: boolean
  /** `parle/recollection/` keys must appear during this scenario. */
  readonly gainsRecollection?: boolean
  /** …and at least one of them must contain this fragment. */
  readonly recollectionKeyed?: string
  /** Every request attributable to the extension's worker goes only to these hosts. */
  readonly swTrafficOnlyTo?: ReadonlyArray<string>
}

export interface Scenario {
  readonly id: string
  readonly kind: string
  readonly adr: ReadonlyArray<string>
  /** Written from the ADRs before the first run. Never edited to match a run. */
  readonly expectation: string
  readonly serve?: ReadonlyArray<ServedPage>
  readonly drive: ReadonlyArray<DriveStep>
  readonly expect: Expect
  /**
   * Environmental interference this scenario is known to be exposed to. When
   * the interference is observed, the runner records a `note` rather than a
   * verdict — a measurement that did not happen is neither a pass nor a fail.
   */
  readonly fragile?: string
}

/**
 * ADR 0014's ceiling made concrete: Algolia meters THE READER'S IP at
 * 10,000/hr, every harness on this box shares one IP, and QA that gets the IP
 * blocked takes all future QA with it. The gate lives at the RUN level — one
 * gate across every shard, never one per shard (`gate.ts`). These are the
 * parameters this corpus asks the gate for, in the gate's own vocabulary;
 * `SWEEP_GATE_URL` points the runner at an existing run-wide gate instead.
 */
export const POLITENESS = {
  /** Sustained ceiling across ALL shards combined, requests per second. */
  requestsPerSecond: 5,
  burst: 5,
  /** What one fresh page-load is charged; see `gate.ts` on why 2.5. */
  costPerPage: 2.5
} as const

const HOST = "parle-kinds.com"

/** The article `parle.e2e.ts` uses: really discussed, servable as plain markup. */
const ARTICLE = "https://www.nature.com/articles/d41586-024-02012-5"
const ARTICLE_TITLE = "Not all 'open source' AI models are actually open"

const page = (title: string, extra = "") =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;padding:48px;max-width:38rem}</style>` +
  `<h1>${title}</h1><p>A page served by the kind corpus.</p>${extra}`

/**
 * A single-page app whose router is `history.pushState`, as data.
 *
 * `#to-a` / `#to-b` navigate the way a real SPA does — address, title and
 * heading all change with no page load. `#burst` walks through two transient
 * addresses 60 ms apart before settling, which is faster than
 * `ReadingWatch.SETTLES_AFTER` (400 ms): the two must never become Readings.
 */
const SPA_BODY = `<!doctype html><meta charset="utf-8"><title>Corpus SPA Shell 70211</title>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;padding:48px;max-width:38rem}</style>
<h1 id="h">Corpus SPA Shell 70211</h1>
<button id="to-a">read alpha</button> <button id="to-b">read beta</button> <button id="burst">burst</button>
<script>
  const go = (path, title) => {
    history.pushState({}, "", path)
    document.title = title
    document.getElementById("h").textContent = title
  }
  document.getElementById("to-a").addEventListener("click", () => go("/reads/alpha", "Corpus Spa Alpha Piece 70212"))
  document.getElementById("to-b").addEventListener("click", () => go("/reads/beta", "Corpus Spa Beta Piece 70213"))
  document.getElementById("burst").addEventListener("click", () => {
    go("/reads/burst-1", "Corpus Burst One")
    setTimeout(() => go("/reads/burst-2", "Corpus Burst Two"), 60)
    setTimeout(() => go("/reads/burst-final", "Corpus Burst Final Piece 70214"), 120)
  })
</script>`

export const SCENARIOS: ReadonlyArray<Scenario> = [
  // ------------------------------------------------------------ 8. iframes
  // First, before anything else can touch the framed article: an absence
  // assertion against an address the trusted-types scenario visits top-level
  // later would be vacuous once the Lookup Record holds it.
  {
    id: "iframe-embeds-discussed-page",
    kind: "iframes",
    adr: ["0012"],
    expectation:
      "A Reading is one reader's encounter with one Subject in one TOP-LEVEL frame " +
      "(ReadingWatch: the filter is one line, and it is here). A page embedding a " +
      "discussed page in an iframe mints no Reading and no Lookup for the frame — " +
      "otherwise an ad iframe would write pages nobody opened into the Local " +
      "Discussion Cache. Only the parent is looked up.",
    serve: [
      {
        address: `https://framer.${HOST}/holder`,
        body: page(
          "Corpus Frame Holder 81511",
          `<iframe src="https://framed.${HOST}/inner-piece" width="400" height="120"></iframe>` +
            `<iframe src="${ARTICLE}" width="400" height="120"></iframe>`
        )
      },
      { address: `https://framed.${HOST}/inner-piece`, body: page("Corpus Framed Inner Piece 81512") },
      { address: ARTICLE, body: page(ARTICLE_TITLE) }
    ],
    drive: [{ goto: `https://framer.${HOST}/holder` }],
    expect: {
      panelOn: `framer.${HOST}`,
      queried: [`framer.${HOST}/holder`],
      neverQueried: [`framed.${HOST}`, "nature.com/articles/d41586-024-02012-5"],
      nothingShown: true
    }
  },

  // ---------------------------------------------------- 1. redirect chains
  {
    id: "shortener-hop",
    kind: "redirect-chain",
    adr: ["0019", "0015"],
    expectation:
      "A served t.co-shaped 302: one Reading at the destination, one Lookup, and " +
      "the shortener address never queried. ADR 0019: the redirect chain is one " +
      "reader's Reading; the pre-redirect address becomes an Alias that reaches " +
      "panelOf (which folds) and never Enquiry (which asks).",
    serve: [
      {
        address: `https://t-co-shaped.${HOST}/x9`,
        status: 302,
        headers: { location: `https://dest.${HOST}/articles/settled-piece` }
      },
      { address: `https://dest.${HOST}/articles/settled-piece`, body: page("Vqxplk Corpus Settled Piece 55011") }
    ],
    drive: [{ goto: `https://t-co-shaped.${HOST}/x9` }],
    expect: {
      panelOn: `dest.${HOST}`,
      queried: [`dest.${HOST}/articles/settled-piece`],
      neverQueried: [`t-co-shaped.${HOST}`],
      atMostAlgolia: 6,
      nothingShown: true
    }
  },
  {
    id: "consent-interstitial-chain",
    kind: "redirect-chain",
    adr: ["0019"],
    expectation:
      "A consent-wall-shaped chain of three: root bounces through /consent and " +
      "lands on the document. One Reading at the destination; the interstitial " +
      "address is never a Subject and never queried (a Sighting that does not " +
      "settle is never seen).",
    serve: [
      {
        address: `https://consenty.${HOST}/`,
        status: 302,
        headers: { location: `https://consenty.${HOST}/consent?continue=%2Freal%2Fdoc` }
      },
      {
        address: `https://consenty.${HOST}/consent?continue=%2Freal%2Fdoc`,
        status: 302,
        headers: { location: `https://consenty.${HOST}/real/doc` }
      },
      { address: `https://consenty.${HOST}/real/doc`, body: page("Wblorx Corpus Consent Landed 55012") }
    ],
    drive: [{ goto: `https://consenty.${HOST}/` }],
    expect: {
      panelOn: `consenty.${HOST}`,
      queried: [`consenty.${HOST}/real/doc`],
      neverQueried: ["consent?continue", `consenty.${HOST}/consent`],
      atMostAlgolia: 6,
      nothingShown: true
    }
  },
  {
    id: "locale-root-live",
    kind: "redirect-chain",
    adr: ["0019"],
    expectation:
      "netflix.com redirects to a locale root (measured /fi-en/ from this box). " +
      "The Subject is the landed address; the bare pre-redirect root is never " +
      "itself queried — it is an Alias, and Aliases reach panelOf, not Enquiry.",
    drive: [{ goto: "https://www.netflix.com/" }],
    expect: {
      panelOn: "netflix.com",
      neverQueriedExactly: ["https://netflix.com/", "https://www.netflix.com/", "http://netflix.com/"]
    },
    fragile: "the landing path is geo-dependent; from another network netflix.com may not redirect at all"
  },
  {
    id: "alias-judged-live-wikipedia",
    kind: "redirect-chain",
    adr: ["0019"],
    expectation:
      "en.wikipedia.org/ redirects to /wiki/Main_Page. ADR 0019 §1: the rule reads " +
      "ALL of a Subject's addresses, so the rootish pre-redirect address makes the " +
      "destination judgeable and the panel folds (was 'showing 11', the worst miss). " +
      "If this un-folds, `traversed` stopped arriving.",
    drive: [{ goto: "https://en.wikipedia.org/" }],
    expect: {
      panelOn: "wikipedia.org",
      foldedAtLeast: 1
    }
  },

  // ------------------------------------------------------ 2. SPA navigation
  {
    id: "spa-pushstate-served",
    kind: "spa-navigation",
    adr: ["0005"],
    expectation:
      "A served SPA pushState-navigates between articles with no page load. Each " +
      "settled URL is its own Subject (ReadingWatch: an in-page boundary is a " +
      "Reading like any other), so /app, /reads/alpha and /reads/beta are each " +
      "looked up by address.",
    serve: [{ address: `https://spa.${HOST}/app`, body: SPA_BODY }],
    drive: [
      { goto: `https://spa.${HOST}/app` },
      { awaitQueried: `spa.${HOST}/app` },
      { click: "#to-a" },
      { waitMs: 3500 },
      { click: "#to-b" },
      { waitMs: 3500 }
    ],
    expect: {
      panelOn: `spa.${HOST}`,
      queried: [`spa.${HOST}/app`, `spa.${HOST}/reads/alpha`, `spa.${HOST}/reads/beta`]
    }
  },
  {
    id: "spa-transient-states",
    kind: "spa-navigation",
    adr: ["0005"],
    expectation:
      "Three pushStates 60 ms apart — faster than the 400 ms settle window. Only " +
      "the last becomes a Reading; the transient addresses are never Looked up. " +
      "Minting a Reading per Sighting would spend Lookups on addresses the reader " +
      "never read.",
    serve: [{ address: `https://spa.${HOST}/app`, body: SPA_BODY }],
    drive: [
      { goto: `https://spa.${HOST}/app` },
      { waitMs: 2500 },
      { click: "#burst" },
      { waitMs: 4500 }
    ],
    expect: {
      panelOn: `spa.${HOST}`,
      queried: [`spa.${HOST}/reads/burst-final`],
      neverQueried: ["burst-1", "burst-2"]
    }
  },
  {
    id: "youtube-watch-live",
    kind: "spa-navigation",
    adr: ["0015"],
    expectation:
      "A real SPA: a YouTube watch page. Canonicalization collapses every YouTube " +
      "surface onto https://youtube.com/watch?v=ID and discards t= (where the " +
      "reader is in the video, never which video). The address query carries the " +
      "video id and never the timestamp. A click to a second video is a new " +
      "settled URL and its own Subject (recorded in the detail).",
    drive: [
      { goto: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s" },
      { waitMs: 6000 }
    ],
    expect: {
      panelOn: "youtube.com",
      queried: ["dQw4w9WgXcQ"],
      neverQueried: ["t=42"]
    },
    fragile: "from an EU IP a fresh profile is bounced to consent.youtube.com, where no watch page ever settles"
  },

  // ---------------------------------------------------- 3. hash-only changes
  {
    id: "fragment-never-a-subject",
    kind: "hash-only",
    adr: ["0015"],
    expectation:
      "Canonical.ts drops the fragment unconditionally, so #part-2 (in-page click) " +
      "and #part-3 (address bar) are the same Subject: after the first Lookup " +
      "burst, no further Algolia request mentions this host, and no query ever " +
      "carries a fragment.",
    serve: [
      {
        address: `https://hashy.${HOST}/long-doc`,
        body: page(
          "Corpus Fragmented Long Doc 61011",
          `<p><a id="jump" href="#part-2">to part two</a></p>` +
            `<div style="height:2400px"></div><h2 id="part-2">Part two</h2><h2 id="part-3">Part three</h2>`
        )
      }
    ],
    drive: [
      { goto: `https://hashy.${HOST}/long-doc` },
      { awaitQueried: `hashy.${HOST}/long-doc` },
      { waitMs: 2000 },
      { mark: true },
      { click: "#jump" },
      { waitMs: 2500 },
      { goto: `https://hashy.${HOST}/long-doc#part-3` },
      { waitMs: 4000 }
    ],
    expect: {
      panelOn: `hashy.${HOST}`,
      quietAfterMark: `hashy.${HOST}`,
      noFragmentInQueries: true
    }
  },

  // ---------------------------------------------- 4. AMP/canonical mismatch
  {
    id: "amp-shaped-with-foreign-canonical",
    kind: "amp-canonical",
    adr: ["0015"],
    expectation:
      "An AMP-shaped URL (piece.amp, ?amp=1) whose rel=canonical points at a " +
      "different host entirely. ADR 0015: a page's self-declared canonical is not " +
      "evidence we observed and is never trusted — only our own rules run. So the " +
      "query is the .amp/tracking-stripped form of the address the reader is ON, " +
      "and the foreign canonical host is never contacted about it. Recorded " +
      "whichever way it lands.",
    serve: [
      {
        address: `https://amps.${HOST}/2024/piece.amp?amp=1&utm_source=corpus`,
        body:
          `<!doctype html><meta charset="utf-8"><title>Corpus Amp Shaped Piece 62011</title>` +
          `<link rel="canonical" href="https://elsewhere-entirely.${HOST}/other/thing">` +
          `<h1>Corpus Amp Shaped Piece 62011</h1>`
      }
    ],
    drive: [{ goto: `https://amps.${HOST}/2024/piece.amp?amp=1&utm_source=corpus` }],
    expect: {
      panelOn: `amps.${HOST}`,
      queriedExactly: [`https://amps.${HOST}/2024/piece`],
      neverQueried: [`elsewhere-entirely.${HOST}`],
      nothingShown: true
    }
  },

  // ------------------------------------------------------- 5. paywalled pages
  {
    id: "nytimes-paywalled-live",
    kind: "paywall",
    adr: ["0005", "0012"],
    expectation:
      "A paywalled NYT article (HN item 39778999, 2,546 points). The ADDRESS is " +
      "still looked up — the product never reads page content, so a paywall costs " +
      "it nothing — the panel renders its Discussions normally, and every request " +
      "attributable to our worker goes to the Networks alone, never to the " +
      "publisher. (The first run scoped this to Algolia alone, forgetting ADR " +
      "0005 asks every Network — Reddit's info.json is a Lookup, not content. " +
      "The publisher half of the claim is unchanged.)",
    drive: [{ goto: "https://www.nytimes.com/2024/03/21/technology/apple-doj-lawsuit-antitrust.html" }],
    expect: {
      panelOn: "nytimes.com",
      queried: ["nytimes.com/2024/03/21/technology/apple-doj-lawsuit-antitrust"],
      linkedAtLeast: 1,
      swTrafficOnlyTo: ["hn.algolia.com", "reddit.com"]
    },
    fragile: "nytimes may interpose a captcha for datacenter IPs; if the tab never reaches the article, nothing was measured"
  },
  {
    id: "wsj-paywalled-live",
    kind: "paywall",
    adr: ["0005"],
    expectation:
      "Same claim against WSJ's harder paywall (HN item 27370026, 2,330 points): " +
      "address looked up, panel normal, no content read.",
    drive: [{
      goto: "https://www.wsj.com/articles/software-developer-community-stack-overflow-sold-to-tech-giant-prosus-for-1-8-billion-11622648400"
    }],
    expect: {
      panelOn: "wsj.com",
      queried: ["software-developer-community-stack-overflow-sold"],
      linkedAtLeast: 1,
      swTrafficOnlyTo: ["hn.algolia.com", "reddit.com"]
    },
    fragile: "wsj bot-walls datacenter IPs; a wall that replaces the article still keeps the address, so the Lookup half may survive it"
  },

  // ------------------------------------------------ 6. non-Latin, non-ASCII
  {
    id: "cjk-idn-served",
    kind: "non-latin",
    adr: ["0014"],
    expectation:
      "A served page on an IDN host with a percent-encoded-UTF8 path and a " +
      "CJK/Cyrillic/emoji title. Canonicalization is byte-stable — the address " +
      "query equals the punycode + percent-encoded form exactly — and the title " +
      "query is the title's own bytes, well-formed. Both come back Silence, " +
      "never a Garble.",
    serve: [
      {
        address: `https://xn--80akhbyknj4f.${HOST}/%E8%A8%98%E4%BA%8B/piece-71393`,
        body: page("コーパス試験 ✨ Проверка 71393")
      }
    ],
    drive: [{ goto: `https://испытание.${HOST}/記事/piece-71393` }],
    expect: {
      panelOn: `xn--80akhbyknj4f.${HOST}`,
      queriedExactly: [`https://xn--80akhbyknj4f.${HOST}/%E8%A8%98%E4%BA%8B/piece-71393`],
      titleQueried: "コーパス試験 ✨ Проверка 71393",
      nothingShown: true
    }
  },
  {
    id: "idn-host-live",
    kind: "non-latin",
    adr: ["0005"],
    expectation:
      "A real IDN host Hacker News has discussed (xn--gckvb8fzb.com, 'Hold on to " +
      "Your Hardware', 662 points). The punycode form is the byte-stable key on " +
      "both sides, so the Discussion is found and rendered.",
    drive: [{ goto: "https://xn--gckvb8fzb.com/hold-on-to-your-hardware/" }],
    expect: {
      panelOn: "xn--gckvb8fzb.com",
      queried: ["xn--gckvb8fzb.com/hold-on-to-your-hardware"],
      linkedAtLeast: 1
    }
  },
  {
    id: "percent-utf8-path-live",
    kind: "non-latin",
    adr: ["0005"],
    expectation:
      "A real percent-encoded-UTF8 path Hacker News has discussed (ja.wikipedia " +
      "Charlie Root, HN item 31972716). If canonicalization re-encodes or decodes " +
      "the path, the exact-match tier silently loses this page — ADR 0005's " +
      "expensive failure — so the submission must be found.",
    drive: [{
      goto: "https://ja.wikipedia.org/wiki/Charlie_Root_(%E3%82%AA%E3%83%9A%E3%83%AC%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%E3%82%B7%E3%82%B9%E3%83%86%E3%83%A0)",
    }],
    expect: {
      panelOn: "ja.wikipedia.org",
      queried: ["%E3%82%AA%E3%83%9A%E3%83%AC%E3%83%BC%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0"],
      linkedAtLeast: 1
    }
  },

  // -------------------------------------- 7. Trusted-Types / strict-CSP hosts
  {
    id: "trusted-types-served",
    kind: "strict-csp",
    adr: ["0016"],
    expectation:
      "The discussed article served under `require-trusted-types-for 'script'`. " +
      "The mark injects cleanly or not at all — never a console error from our " +
      "code. If the pill's injection path assigns unvetted HTML, this is where " +
      "it surfaces.",
    serve: [
      {
        address: ARTICLE,
        headers: { "content-security-policy": "require-trusted-types-for 'script'" },
        body: page(ARTICLE_TITLE)
      }
    ],
    drive: [{ goto: ARTICLE }, { waitMs: 5000 }],
    expect: {
      panelOn: "nature.com",
      linkedAtLeast: 1,
      consoleClean: true
    }
  },
  {
    id: "github-strict-csp-live",
    kind: "strict-csp",
    adr: ["0016"],
    expectation:
      "github.com ships a strict CSP. On a discussed repo page the mark appears " +
      "(or nothing does) with zero console errors from our code.",
    drive: [{ goto: "https://github.com/torvalds/linux" }, { waitMs: 4000 }],
    expect: {
      panelOn: "github.com",
      linkedAtLeast: 1,
      consoleClean: true
    }
  },

  // -------------------------------------------------- 9. enormous answer sets
  {
    id: "many-submissions-live",
    kind: "enormous-answers",
    adr: ["0006"],
    expectation:
      "joelonsoftware's 'Things You Should Never Do' carries 31 submissions " +
      "(measured 2026-08-10). The panel stays usable: repeats fold into an 'also " +
      "submitted N times' clause on the surviving row rather than 30 rows, and " +
      "because 31 < the 50-hit window the census is complete — so the 'not all " +
      "of them' window note must be ABSENT (saying otherwise would be the lie).",
    drive: [{
      goto: "https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/"
    }],
    expect: {
      panelOn: "joelonsoftware.com",
      linkedAtLeast: 1,
      repeatClauseAtLeast: 10,
      noWindowNote: true
    }
  },
  {
    id: "common-title-topical-served",
    kind: "enormous-answers",
    adr: ["0018"],
    expectation:
      "A served page titled 'Rust': the title search fills its whole thirty-hit " +
      "window. The topical group draws a large but bounded set (<= 30), stays " +
      "usable, and carries NO window note — a title search is a sample by " +
      "design, not a truncated census (HackerNews.topicalAnswer, ADR 0018).",
    serve: [{ address: `https://generic.${HOST}/rust-notes`, body: page("Rust") }],
    drive: [{ goto: `https://generic.${HOST}/rust-notes` }, { waitMs: 4000 }],
    expect: {
      panelOn: `generic.${HOST}`,
      topicalAtLeast: 15,
      topicalAtMost: 30,
      noWindowNote: true
    }
  },

  // ------------------------------------------- 10. the reader's own Networks
  {
    id: "hn-item-page-live",
    kind: "own-networks",
    adr: ["0012"],
    expectation:
      "A Hacker News item page: Harvest fires (the Local Discussion Cache gains " +
      "rows keyed on the addresses the links resolve to — here the nature " +
      "article), and the page itself is never Looked up in a way that loops: " +
      "news.ycombinator.com is on the Exclusion List, so no Algolia query names " +
      "it and the panel says so.",
    drive: [{ goto: "https://news.ycombinator.com/item?id=40786237" }, { waitMs: 5000 }],
    expect: {
      panelOn: "news.ycombinator.com",
      excluded: true,
      neverQueried: ["news.ycombinator.com"],
      gainsRecollection: true,
      recollectionKeyed: "d41586-024-02012-5"
    }
  },
  {
    id: "reddit-comments-page-live",
    kind: "own-networks",
    adr: ["0012", "0013"],
    expectation:
      "A Reddit comments page: Harvest fires on the page the reader is already " +
      "on, and the page itself is excluded (social) — no Lookup names it. " +
      "Reddit refusing this box's IP refuses the measurement, not the claim.",
    drive: [{
      goto: "https://old.reddit.com/r/programming/comments/9x15g/programming_thought_experiment_stuck_in_a_room/"
    }, { waitMs: 5000 }],
    expect: {
      panelOn: "reddit.com",
      excluded: true,
      neverQueried: ["old.reddit.com/r/programming/comments"],
      gainsRecollection: true
    },
    fragile: "old.reddit answers 403 to this box's IP even in a browser some days; a refused page has no links to harvest"
  },

  // ------------------- 11. ADR 0005 insurance: the fixes' own failure modes
  // The 2026-08-10 fixes for P1 (carrier dwell) and P3 (no-title withholding +
  // re-fire) each trade an immediate action for a delayed one. ADR 0005 bounds
  // both: a delay may never become a withholding. These two rows are the
  // tripwire on that bound — each asserts the Lookup the fix postpones DOES
  // eventually happen.
  {
    id: "carrier-query-page-read",
    kind: "redirect-chain",
    adr: ["0005", "0019"],
    expectation:
      "A REAL page whose query VALUE is URL-shaped (?from=%2Fnewsletter%2Fjuly) " +
      "that the reader stays on. The carrier dwell (ReadingWatch, " +
      "carriesAnAddress -> CARRIER_SETTLE_FACTOR x settle window) may DELAY " +
      "its Reading, never " +
      "withhold it: the address is still Looked up — one burst, not two — and " +
      "the panel settles. ADR 0005: the interstitial rule is 'not yet', never " +
      "'not at all'.",
    serve: [
      {
        address: `https://carrier.${HOST}/landing?from=%2Fnewsletter%2Fjuly`,
        body: page("Xqzpbm Corpus Carrier Landing Piece 88011")
      }
    ],
    drive: [
      { goto: `https://carrier.${HOST}/landing?from=%2Fnewsletter%2Fjuly` },
      // The dwell is 2 s (5 x 400 ms); wait past it plus a Lookup round-trip.
      { waitMs: 5000 }
    ],
    expect: {
      panelOn: `carrier.${HOST}`,
      queried: [`carrier.${HOST}/landing`],
      atMostAlgolia: 6,
      nothingShown: true
    }
  },
  {
    id: "late-title-topical-refire",
    kind: "late-title",
    adr: ["0005"],
    expectation:
      "A page with NO <title> whose script sets one 900 ms after load — past " +
      "the 400 ms settle window, so the Reading is sighted under the browser's " +
      "address-shaped placeholder and the Topical Lookup withholds as " +
      "`no-title` (never sending the address dressed as a title). When the " +
      "real title lands, the withheld Topical RE-FIRES: the title query on the " +
      "wire is the title's own bytes. Wire guard alone (no re-fire) fails this " +
      "row silently — that is exactly the false negative ADR 0005 forbids.",
    serve: [
      {
        address: `https://latetitle.${HOST}/piece`,
        body:
          `<!doctype html><meta charset="utf-8">` +
          `<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;padding:48px;max-width:38rem}</style>` +
          `<h1>A page still deciding what to call itself</h1>` +
          `<script>setTimeout(() => { document.title = "Qzmvrw Corpus Late Title Piece 88012" }, 900)</script>`
      }
    ],
    drive: [
      { goto: `https://latetitle.${HOST}/piece` },
      { waitMs: 5000 }
    ],
    expect: {
      panelOn: `latetitle.${HOST}`,
      queried: [`latetitle.${HOST}/piece`],
      titleQueried: "Qzmvrw Corpus Late Title Piece 88012",
      nothingShown: true
    }
  }
]
