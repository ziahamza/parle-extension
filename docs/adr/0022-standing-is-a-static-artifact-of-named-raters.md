# We ship other people's ratings, named, offline, and never as our own

Parle compiles what four named public raters have published about news publishers into a single
static, domain-keyed artifact — `packages/standing/data/standing.json`, 183 KB raw, 36 KB gzipped,
2,834 publishers — and ships it inside the build. A reader on a rated page can be shown what those
raters said about its publisher. Every claim carries the name of who made it and is displayed as
theirs. Parle assigns no rating of its own, here or anywhere.

This is the artifact [ADR 0009](./0009-audience-spread-not-outlet-ratings.md) anticipated when it
refused left/right ratings *as Parle's judgement* and closed with *"licensed outlet ratings remain a
possible independent static artifact and a separate effort. Nothing here forecloses them."* It does
not reverse that ADR. Spread — where a page actually travelled — remains what Parle observes and
says for itself. Standing sits beside it and is entirely somebody else's speech.

The four layers, and what each cost:

| Layer | Licence | How it arrived | In the artifact |
|---|---|---|---|
| **Wikipedia perennial sources** | CC BY-SA 4.0 | Direct, one MediaWiki `action=parse` call | 493 rows → **700 domains** carry a reliability status |
| **The Iffy Index** | CC BY 4.0 | Direct, one CSV fetch of the published sheet | **2,000 domains** flagged, with an MBFC-derived factual grade |
| **AllSides** | CC BY-NC 4.0 | allsides.com returned **403** to the one polite attempt; read from a community mirror | 325 publisher rows, 258 joined → **273 domains** carry a lean |
| **Wikidata** | CC0 1.0 | Direct, one SPARQL query scoped to the outlets the other layers name | **565 publishers** carry alignment, founding year, owner or country |

## Why a static artifact and not a lookup

`docs/research/enrichment-sources.md` states the rule this obeys: *a static artifact compiled at
build time beats a live Lookup wherever both exist.* Every per-page request tells whoever answers it
what the reader is reading. A rating looked up locally in a file the reader already has discloses
nothing at all — no request, no IP, no timing, no budget to meter, nothing to withhold and no reason
owed for withholding it. The whole feature costs zero Lookups, which is why it can exist in a product
whose position on disclosure is as strict as this one's.

It also makes the artifact hermetic. The build fetches; the release does not. `packages/standing/data/standing.json`
is committed, and `packages/standing/tools/build.ts` exists to refresh it on a developer's machine —
five requests, sequential, spaced, under a User-Agent that names the project. No release depends on
four third parties being up that morning.

## Why attribution is the load-bearing constraint

[ADR 0006](./0006-the-digest-reports-it-does-not-adjudicate.md) draws the line at the point where the
product stops describing and starts judging, and requires a citation wherever a judgement appears.
The same line cuts here, and harder, because a publisher rating is a *permanent label on an
institution* rather than a claim about one page. "This publication leans left" is an assertion we
would have to defend. "AllSides rates this publication Lean Left" is a checkable fact about AllSides
that cannot be wrong in the way a verdict can — and the reader can go and argue with AllSides, which
is the entire point of the product.

So the attribution is structural rather than a rendering convention. Every case of `StandingClaim`
carries `origin` and a ready-to-show `attribution` string — "Lean Left — per AllSides" — and there is
no constructor that produces a claim without one. A panel that shows a lean with no rater beside it
is precisely what ADR 0009 refused, and it should not be reachable by forgetting a field.

## Considered options

- **Ground News.** Not a source. No public API, its terms prohibit scraping and reuse, and its
  ratings are not its own — it averages Media Bias/Fact Check, AllSides and Ad Fontes, paying at
  least Ad Fontes for the privilege. "Add Ground News" resolves to "deal with the three raters Ground
  News pays", and two of the three are dealt with directly here. Aggregating an aggregator would also
  destroy the one thing that makes this shippable: an averaged number cannot be attributed to anyone.
- **Ad Fontes Media.** Commercial data platform only, undisclosed pricing. A dead end for an AGPL
  extension with no revenue.
- **Media Bias/Fact Check by licence.** 11,000+ domains — the only Ground News-scale set, four times
  everything here combined. Their Data API is $10–$200/mo with no redistribution, but they negotiate
  direct licences and have offered reduced terms to nonprofits and open projects, and the
  `drmikecrowe/mbfcext` extension is the precedent that they have blessed a browser extension before.
  **The route is an email to `editor@mediabiasfactcheck.com`, and it is the highest-value open item
  this ADR leaves behind.**
- **Media Bias/Fact Check by scrape.** Several unlicensed GitHub mirrors of the full MBFC set exist
  and would have quadrupled coverage this afternoon. **Refused.** They carry no licence, so shipping
  one is a takedown waiting to happen — in a product whose entire proposition is that it can be
  trusted about where information comes from. A trustworthiness product cannot launder its own
  sourcing. The same reasoning is why the build reads the Iffy Index's factual-reporting column and
  deliberately *not* its MBFC bias column: taking MBFC's left/right rating out of somebody else's
  lawful republication is the refused thing through a side door.
- **Our own methodology.** ADR 0009 priced this: an ongoing defence of a rating system, forever. Not
  a model problem, not a data problem, and not a fight worth having.

## Consequences

- **The noncommercial clause binds the project while AllSides is aboard.** CC BY-NC 4.0 permits
  redistribution for noncommercial purposes only. Parle is free, AGPL-3.0, and has no revenue, so
  this costs nothing today — but the day anyone proposes a paid tier, sponsorship, or a commercial
  fork, the AllSides layer must come out first or be licensed. `NONCOMMERCIAL_NOTICE` in
  `packages/standing/src/Artifact.ts` exists to be found by whoever proposes it.
- **Attribution is an obligation, not a courtesy.** CC BY, CC BY-SA and CC BY-NC all require the
  source and licence be named wherever the material is used. `licenceNotices()` produces one line per
  rater, and **the integration wave must render them somewhere a reader can reach.** Shipping the
  artifact without a credits surface is a licence breach, not a missing nicety.
- **The AllSides layer is a mirror, and its vintage is not today's.** allsides.com sits behind a bot
  defence that answered 403; the ratings come from the community-maintained
  `favstats/AllSideR` CSV, whose data file was last committed in 2019. The provenance block records
  `obtained: "mirror"` and says so in a note. This is the layer most likely to be wrong, and the
  right fix is the MBFC licence email above or a direct AllSides licence — not a better scraper.
- **The artifact can be wrong about a publisher, and staleness is bounded by release cadence.** A
  rater can be mistaken, a domain can change hands, a rating can move the week after a build. Nothing
  here refreshes between releases and nothing should: the alternative is a per-page request, which is
  the thing the design exists to avoid. `fetchedAt` per layer is in the artifact so the age is
  visible rather than implied.
- **Disagreement is dropped, not resolved.** Wikipedia's list rates some publishers more than once —
  Fox News separately for politics and science — and AllSides rates a paper's news desk separately
  from its editorial page. Where two rows of one rater land on one domain with different verdicts,
  **no claim is written** (44 domains for Wikipedia, 4 for AllSides). Picking the harsher one is us
  calling a publisher unreliable; picking the kinder one is us clearing it; inventing "contested" is
  us assigning a status the rater did not. `foxnews.com` and `theguardian.com` both lose their
  Wikipedia reliability claim this way. It is a real cost and the honest one.
- **AllSides' ratings of *people* and of *sections* are excluded entirely.** A third of the mirror's
  rows are columnists and cartoonists, and others rate opinion pages. The only key this artifact has
  is a domain, so a columnist's rating hung on `wsj.com` would read as a rating of the paper AllSides
  never made. 201 author rows and every opinion-section row are dropped.
- **The name-to-domain join is partial and will stay partial.** AllSides publishes outlet names;
  ratings are shown against domains. The join goes through Wikidata's P856 twice — by enwiki article,
  which is exact, and by English label, which is not — plus a hand-checked overrides table of about a
  hundred lines. 258 of 325 publisher rows joined. Seven domains were dropped as bad joins because
  several unrelated outlets resolved to them (`hdl.loc.gov`, `search.ebscohost.com` — database hosts
  a Wikidata `P856` happens to point at). The residue is small regional papers, and adding one is a
  line in `OVERRIDES`, not a new mechanism.
- **A malformed artifact yields no Standing rather than a wrong one.** `readStanding` refuses unknown
  values, unknown rater names, a schema version it does not support, and anything that throws while
  being read. A build that half-understands the artifact shows a reader something confidently wrong in
  a third party's name, which is worse than showing nothing.
- **The subdomain walk is bounded by a hand-written suffix table, not a public suffix list.** The real
  list is ~15,000 lines and changes weekly. `TWO_LEVEL_SUFFIXES` is about sixty entries covering the
  suffixes the rated publishers actually use. Both directions of error — a missing suffix, a wrong one
  — cost a *missed* Standing rather than a wrong one, which is the direction this codebase's failures
  are always arranged to fall.

## The reader-facing vocabulary this needs

`CONTEXT.md` binds the UI to five words: Discussion, Digest, Finding, Spread, Provider. This feature
cannot be built from those five, and the missing word is proposed here for the integration wave to
add:

> **Standing**:
> What named public raters say about this page's publisher — always someone else's judgement, always
> named. Compiled before the reader ever opens the page, so asking costs nothing and tells nobody.
> _Avoid_: rating, score, trust, credibility score, bias rating

Two things must be reconciled when it lands, and neither is cosmetic:

1. **Spread's `_Avoid_` list currently contains "bias".** That entry was written when Parle had no
   left/right dimension at all and "bias" was the word people would wrongly reach for to describe
   Spread. It still is — Spread is an observed pattern of travel and must never be called a bias
   measurement — so the avoidance stays where it is, scoped to Spread. What must change is the
   surrounding assumption that "bias" is an unusable word product-wide. It remains unusable *in
   Parle's own voice*; it is perfectly usable inside a quotation, because AllSides' own product name
   for what it publishes is a media bias rating and renaming somebody else's rating while attributing
   it to them is its own kind of misquotation. The rule the glossary should carry: **Parle never
   describes anything as biased; a named rater may, in their words, with their name attached.**
2. **Standing and Spread must read as different kinds of thing on screen.** Spread is what Parle
   observed about *this page*. Standing is what other people concluded about *the publisher*, on
   evidence Parle has not examined and a methodology it does not endorse. If they render alike, ADR
   0009's distinction survives in the glossary and dies in the panel — which is the only place it
   matters.

## Status

Accepted, 2026-08-24. `packages/standing` builds, type-checks and passes 41 tests, including the
checked-in artifact validating against its own schema, the size budget, provenance completeness, the
`co.uk` walk, and a malformed artifact failing closed.

**Integrated, 2026-08-24, and here is what the integration decided.** The two reconciliations this
ADR left open are settled in `CONTEXT.md` and in the panel:

- **Standing is a reader-facing term**, added verbatim as proposed. Spread keeps "bias" on its
  `_Avoid_` list, scoped to Spread, with a note saying why; the header rule now carries the sentence
  this ADR asked for — *Parle never describes anything as biased; a named rater may, in their words,
  with their name attached.*
- **Standing and Spread do not render alike, because Standing renders in a named group of its own.**
  The panel draws a compact context block with two headed groups — Archive (what the Internet Archive
  holds about *this page*) and Standing (what named raters concluded about *the publisher*, plus which
  Wikipedia articles cite the page). Spread is not built, so the two do not yet share a screen; when
  it is, the group heading is what keeps them apart, and `view/context.test.ts` asserts the headings
  exist and are distinct.
- **Every claim is drawn from `attribution` verbatim**, and a test walks the shipped artifact's own
  rows to prove no line reaches a reader without a rater's name on it.
- **The licence obligation is discharged on the settings page**, which renders `licenceNotices()` one
  line per rater and `NONCOMMERCIAL_NOTICE` beneath them, reachable without dev tools. That was a
  shipping condition, not a nicety, and it is now met.

The MBFC licence email in the options above remains the highest-value open item this ADR leaves
behind.
