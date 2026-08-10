# A Front Door is judged on its Aliases, and a homepage somebody said they built is never one

[ADR 0017](./0017-front-doors-fold-old-discussions-and-are-remembered.md) shipped the Front Door rule, and its own QA
sweep named where it still failed. This ADR closes the worst of those misses, fixes a defect the sweep could not see
because the corpus was too thin to contain it, and refuses two proposed widenings with numbers so that refusing them
again is cheap.

**Nothing here moves a threshold.** 0.35 is still 0.35, the horizon is still thirty days, the incident lexicon is still
six words, and time spread is still nowhere in the module.

---

## 1. The worst miss: `en.wikipedia.org/`

`en.wikipedia.org/` redirects to `/wiki/Main_Page`. The rule judged `isRootish(the elected Subject URL)`, and a
two-segment path is not rootish — so the encyclopedia's front page was never judged at all, and the panel drew eleven
rows on it: *"Wikipedia Is Down?"*, *"Wikipedia is blacked out"*, *"Wikipedia was down"*, *"Kiwi Farms"*.

The fix is not a word list and not a special case. **A Subject is "identified by the set of addresses believed to point
at one reading of it"** — and the rule was reading one of them. It now reads all of them:

```
FrontDoor := anyRootish(the Subject's addresses)
         AND ( meanPairwiseTitleJaccard <= 0.35  OR  a title reports an outage )
         AND NOT somebody said they built the thing here          ← see §2
```

The address that makes Wikipedia judgeable is the one the reader's browser started from, and **that is evidence ADR 0015
already admits** — one of exactly three kinds, alongside our own canonicalization and a Network's own submitted URL, and
pointedly not a page's self-declared `rel=canonical`. A site cannot make itself un-judgeable by asserting a deep
canonical, because nothing a page says about itself reaches this rule.

### Widening what may be judged is the dangerous direction, so it was measured first

Every one of the 732 corpus addresses carrying a submission was fetched following redirects.

| | |
|---|---|
| redirect anywhere else | **57 of 732** |
| turn a rootish address into a deep one, i.e. become newly judgeable | **14** |
| of those 14: front doors / real pages / classics | **14 / 0 / 0** |

The fourteen are locale roots (`uber.com/fi/en/`, `stripe.com/en-fi`, `netflix.com/fi/`, `robinhood.com/eu/en/`,
`squareup.com/us/en`, `paypal.com/fi/home`, `ibm.com/de-*`, `salesforce.com/de/`), sections
(`stackoverflow.com/questions`, `theguardian.com/europe`, `craigslist.org/area/helsinki`), a consent wall
(`yahoo.com` → `consent.yahoo.com/v2/collectConsent`) and two sign-in flows. Locale roots are a class `ROOT_SEGMENTS`
can never cover, because there is one per country.

The adversarial case is the only way this can silence a page worth reading: **a site whose root redirects onto one of
its own documents.** It was probed directly — the roots of all **353 hosts in the corpus that carry a genuine deep-path
positive**. 13 redirect to a non-rootish address and **none of them lands on that site's own document**. Every one lands
on another front door: `/projects/`, `/dashboard`, `/home.aspx`, `/3/`, `/en-EU`, `/europe`, `/wiki/Main_Page`.

### The recall it buys today is one page, and that is stated rather than dressed up

Of those fourteen, **thirteen have no submissions at the destination at all**, so there is nothing to fold. The gain is
Wikipedia and only Wikipedia. That is [ADR 0018](./0018-the-retrieval-gap-is-fuzzy-matching-not-the-window.md)'s
retrieval gap showing through rather than a weakness in this change: when those destinations start answering, they
become folds this rule handles and the elected-URL-only rule cannot.

Measured through the connector's query exactly as it ships today (`typoTolerance=false`, `hitsPerPage=50`):

| address | exact hits | agreement | before | after |
|---|---|---|---|---|
| `en.wikipedia.org/wiki/Main_Page`, deep-linked | 13 | 0.138 | Document | Document |
| the same, reached from `en.wikipedia.org/` | 13 | 0.138 | Document | **FrontDoor (incident)** |
| `sicpdistilled.com/` | 2 | 0.400 | Document | Document |
| `grugbrain.dev/` | 13 | 0.653 | Document | Document |
| `paulgraham.com/greatwork.html` | 5 | 1.000 | Document | Document |
| `danluu.com/empirical-pl/` | 8 | 0.366 | Document | Document |
| `danluu.com/everything-is-broken/` | 7 | 0.498 | Document | Document |
| `tonsky.me/blog/disenchantment/` | 7 | 1.000 | Document | Document |

Re-run in a real Chrome through `e2e:frontdoor`, the whole path works end to end — `onBeforeNavigate` fires,
`traversed` carries `https://en.wikipedia.org/` through the settle, and the panel at `/wiki/Main_Page` draws the fold:

```
  ok    quiet  folded 11              https://en.wikipedia.org/          ← was "showing 11", the worst miss
  ok    shows  showing 7              https://paulgraham.com/greatwork.html
  ok    shows  showing 4              https://grugbrain.dev/
  ok    shows  showing 4              https://sicpdistilled.com/          ← 7/7 classics intact

  54/82 as expected, 7 wrong, 21 nothing to judge   (was 53 / 8 / 21)
```

27 of 27 Hacker News front-page links still show their Discussions, and the folds that were already right are unchanged:
`github.com` 6, `cloudflare.com` 9, `amazon.com` 7, `apple.com` 5, `python.org` 3, `archive.org` 3, `nytimes.com` 1.
The seven remaining wrong rows are the four refused in §3 and §4, `doc.rust-lang.org/book/` (whose two submissions agree
at 1.000 and would not fold even if the path were judged), the Reddit row the previous sweep already showed was a wrong
expectation, and the deep-linked `/wiki/Main_Page` below.

**A reader who deep-links straight to `/wiki/Main_Page` still sees all eleven rows**, and the sweep still records that
row as wrong. It is not a bug to fix later: no redirect was observed, so there is no evidence, and uncertainty runs
toward showing. Two readers on one address can therefore see different panels — the honest consequence of judging on
evidence we observed rather than on a list somebody typed, and it errs the safe way in both directions. Closing it would
mean guessing from the host, which is the thing this rule has refused to do since ADR 0017.

### Where the wider evidence is allowed to reach, and where it is not

The redirect chain belongs to one reader's Reading in one tab. An Enquiry is Subject-keyed and shared by every tab on
the page, and it is the Enquiry's verdict that gets written to `FrontDoorMemory` and that may gate a Topical Lookup and
X's stale evidence.

**So the Aliases reach `panelOf`, which folds, and not `Enquiry`, which asks.** One tab's navigation can never decide —
or persist — what another tab is allowed to ask. Nothing in this change can cause a Lookup to be skipped. The half it
does reach is re-derived on every frame and costs one click to undo.

---

## 2. The defect the corpus was too thin to contain: the rule was silencing Show HN launches

ADR 0017 shipped with this admission: *"The safety evidence is thin and should be widened. The rule can only touch the
rootish real pages in the corpus — 35 of 591 — of which 27 have a single submission. Seeding 150+ Show HN homepage
launches and re-running is the highest-value follow-up."*

Done, thirteen times over: **1,959 Show HN and Launch HN submissions whose submitted URL is a bare root**, sampled
evenly per half-year from 2016 to 2026 and re-queried through the connector's own query. This is the class where the
homepage genuinely IS the item — the case the rule can hurt most and had the least evidence about. 1,244 of them are
old enough for the fold to reach, so this is not a sample the thirty-day horizon protects.

**The rule as shipped called 322 of them (16.4%) a front door, and would have folded away every row of 235 of them
(12.0%).** One in eight Show HN homepage launches, silenced behind a line.

| points | address | what its titles are |
|---|---|---|
| 222 | `gitdiagram.com` | *"Show HN: Instantly visualize any codebase as an interactive diagram"* / *"Show HN: Instantly understand any GitHub repo"* / *"Visualize Any Repository"* |
| 117 | `tabserve.dev` | *"Show HN: Tabserve.dev. HTTPS proxy using Web Workers and a Cloudflare Worker"* / *"…A HTTPS url for localhost using only the browser"* |
| 86 | `pickcode.io` | four Show HNs across four years, four different pitches |
| 46 | `numpad.io` | *"…a web-based notepad with a built in unit calculator"* / *"…rewrote my notepad calculator as a local-first app with CRDT syncing"* |

The mechanism is not exotic and it is not rare: **a founder resubmits their own homepage over a year with a different
pitch each time.** Low mean pairwise title agreement is *exactly* what that produces. It is ADR 0005's expensive failure
— a false negative nobody can complain about — happening on the pages a reader most wants the panel to work on.

### The fix, and why it needs no new machinery

**A `Show HN:` or `Launch HN:` submission is a claim that the address IS the thing.** That is already the argument the
incident clause rests on — its `Show/Ask/Tell/Launch HN` guard is what stopped *"Launch HN: HyperProbe (YC S26) – Agents
that do read-only debugging in prod"* being read as an outage. The same argument is now applied to the title half.

Narrower than the incident clause's guard, on purpose: **`Show` and `Launch` only.** `Ask HN` and `Tell HN` are about
the poster's question or news — *"Tell HN: GitHub Apps – Private key is not private"* points at `github.com/login` and
is a submission about an organisation, not a thing somebody shipped.

| | before | after |
|---|---|---|
| Show HN root launches judged a front door | 322 / 1,959 (16.4%) | **3 / 1,959 (0.15%)** |
| …of which every row silenced | 235 (12.0%) | **3** |
| corpus recall, full retrieval | 73.0% (103/141) | 69.5% (98/141) |
| corpus recall, live window | 49.3% (33/67) | 46.3% (31/67) |
| corpus real pages folded | 0.7% (4/591) | **0.7% (4/591)** |
| classics folded | **0/57** | **0/57** |

The three that remain are 9, 9 and 5 points: two are genuinely shutting-down news caught by the incident clause, and
`paperswithcode.com` has no `Show HN` prefix left in the window the connector retrieves. The 3.5 points of recall it
gives up are five addresses — `netlify.com`, `squareup.com`, `railway.app`, `fly.io`,
`obsidian.md` — and **every one of them is a company whose homepage was a Show HN.** The recall was never front doors.
`obsidian.md` is one of the five product landings ADR 0017 recorded as a known cost of shipping; this removes it.

**Order is load-bearing.** `anyIncident` is consulted before this guard and is not weakened by it, so a `Show HN`
submission pointed at `github.com` cannot buy that site out of the fold — *"GitHub is down"* still decides. There is a
test for that. The guard can only ever cause MORE Discussions to be shown, which is the direction ADR 0005 requires
every uncertainty in this module to run.

**It can be gamed, and that is acceptable**, which is worth writing down rather than discovering. Anyone may submit
"Show HN: …" pointing at any homepage, and doing so takes that address out of the title half. What they win is a
*noisier* panel on that site — the fold is what makes a front door quiet. Nothing here can hide a Discussion, and the
incident clause, which catches the loudest front doors, is not reachable this way at all.

---

## 3. Refused: judging a rootish page with one submission by whether its title is just the site's name

`openai.com/` shows one Discussion because one submission cannot disagree with itself. The proposed signal was: *does
the single title consist essentially of the site's own name, with nothing describing content?* — `newyorker.com` /
*"The New Yorker"*.

Measured on the same 1,959 launches, of which **1,440 have exactly one submission** and 858 are old enough for the fold
to reach:

| | |
|---|---|
| front doors it newly folds | **1 of 28** — `newyorker.com` |
| real pages it newly folds | **20 of 858** |
| precision of the addition | **4.8%** |

The twenty include `18words.com` (**1,160 points**, *"Show HN: 18 Words"*), `dogapi.dog` (275, *"Show HN: Dog API"*),
`rssbrain.com` (139), `talkpaperscissors.com` (102) and `circuitverse.org`. **A product named after what it does has a
title that is its own name — that is what naming a product well produces**, and no threshold separates it from a
magazine's masthead. It buys one quiet page for twenty real ones.

Not shipped. `openai.com/` and every other rootish `n=1` page stays as it is.

---

## 4. Refused again, and for a different reason than ADR 0017 gave: the generic-path word list

`github.com/login` (8 rows), `openai.com/pricing` (2) and `nytimes.com/section/technology` (1) are front doors at deep
paths. ADR 0017 records the entrance-word widening as rejected because it costs `up.codes/careers`, a real page with 22
submissions.

**That reason does not reproduce against the rule as shipped.** `up.codes/careers` scores **0.452** over its 22 titles —
they are all *"UpCodes (YC S17) is hiring …"* — comfortably above the 0.35 threshold, with no incident word. It is not
folded on full retrieval, and live it returns zero exact hits, so it is not folded there either. **The recorded
counterexample was stale, and a rejection resting on a stale counterexample is one somebody re-opens.**

The widening is refused on better evidence. Hacker News' own url index was searched for **every address of the shape
`host/<entrance word>`** anyone has ever submitted — 616 of them across 30 words — and each run through the shipped
title half:

| | |
|---|---|
| addresses the widening would fold | **39 of 616** |
| genuine front doors among them | 22 |
| **real pages whose submissions are about them** | **17** |
| precision | 56% |
| points folded belonging to front doors | ~1,400 |
| **points folded belonging to real pages** | **~2,600** |

**It folds more of what readers came for than of what they did not.** The five loudest pages it silences are
`kayak.com/explore` (668, *"Where can I fly for how much?"*), `boringcompany.com/faq` (624, *"The Boring Company FAQ"*),
`subreply.com/trending` (447), `suno.com/explore` (390, *"Suno Explore – roll the dice for random genres"*) and
`hellosystem.github.io/docs` (319). The loudest real page it gains is `openai.com/pricing` at 192.

The failure is structural rather than a bad word choice, and it is the same one §2 is about: **a small product's Show HN
is submitted with the URL of its login page, its docs or its FAQ**, several times, with a different title each time.
`play.tirreno.com/login`, `ripple.orcas.land/signin`, `convert.mitta.ai/login`, `alphachat.ai/faq`,
`connected2.me/register` and `picktoread.com/register` are all this. Narrowing to the four auth words (`login`,
`signin`, `signup`, `register`), where a document can never live, still scores 10 gains against 8 costs.

And the obvious guard makes it worse: excluding addresses whose submissions carry a `Show HN:` prefix — §2's guard,
applied here — loses `github.com/login`, which is one of the three misses the widening exists to catch.

Not shipped. **`github.com/login`, `openai.com/pricing` and `nytimes.com/section/technology` keep showing their
Discussions**, and that is a decision with a price on it rather than an oversight.

---

## Consequences

- `judge` takes `ReadonlyArray<string>` — the addresses — instead of one address. `anyRootish` and `builtHere` are
  exported beside `isRootish`. `RULES_VERSION` goes to **2**, so no stored judgement outlives the code that made it.
- `ReadingBoundary` and `Reading` gain `traversed`: the addresses passed through, oldest first. `WebExtApi` adds a
  `webNavigation.onBeforeNavigate` listener under the permission it already holds — for a server redirect that is the
  only event carrying the address the navigation started from, because `onCommitted` reports the destination and
  nothing else. The listener is optional in the API shape, because a missing Alias costs a fold rather than causing one.
- **An `intended` Sighting can never become a Reading's address**, enforced in the type rather than in a branch:
  `causeOf` takes a `Settling`, which excludes it. A cancelled navigation or a link that turned out to be a download
  must not open an Enquiry, and that failure would look exactly like the product working.
- `traversed` is bounded three ways — by the settle window at the moment a Reading settles, by four entries, and by the
  next Reading, which clears it. The first is the load-bearing one: without it, the page the reader was on a minute ago
  would decide what the page they are on now is, and a stale rootish hop would fold a real document.
- **The Alias does not survive an MV3 worker restart, and that is left alone.** `Board` holds Readings in memory; when
  the worker is torn down and a surface asks again, the Reading is rebuilt from the tab's current address with an empty
  `traversed`, so a page reached by redirect un-folds until the reader navigates to it again. Persisting it would mean
  writing one reader's navigation to disk to make a *suppression* stickier, which is the wrong thing to make sticky. The
  degradation shows more Discussions, not fewer.
- `FrontDoorMemory.siteOf` already keeps a path when there is one, so `en.wikipedia.org/wiki/Main_Page` is a valid key.
  ADR 0017's "every key is a host" becomes "every key is a host, or a host and one path". The sizing claim is unaffected
  in practice — the destinations are locale roots and index paths — but it is no longer exactly true.
- **What is still open**: an `n=1` rootish front door with no incident word is still shown (§3), and a deep-path front
  door is still shown (§4). Both are refusals with measurements attached, not gaps nobody looked at.
