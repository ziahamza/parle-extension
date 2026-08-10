# A site's front door folds its old Discussions, and the judgement may be remembered

`bankofamerica.com` is an organisation people discuss forever. A Bank of America blog post is one thing people
discussed once. Both accumulate submissions to Hacker News, and until now the panel drew them identically — so a reader
who opened `google.com` got 148 rows about 148 unrelated events and learned not to trust the panel before they ever
reached a page it would have helped on.

**A Subject whose address is a site's entrance rather than a document is a Front Door.** On one, Discussions older than
thirty days are **folded** behind one disclosed, counted, one-click line. Nothing is deleted, nothing is un-asked, and
the Discussions are already in the panel when the line is drawn.

## The signal is not time spread

The proposed rule was that an everlasting page's Discussions are scattered across all history while a real item's
cluster around publication. Measured over 732 pages with at least one submission — 591 real pages including 57
hand-labelled classics, 141 front doors — it carries no information:

| threshold | front doors hidden | real pages silenced | classics silenced | precision |
|---|---|---|---|---|
| span ≥ 365d | 75.9% | 13.4% | **98.2%** | 57.5% |
| span ≥ 1825d | 46.1% | 8.8% | 77.2% | 55.6% |
| span ≥ 3650d | 26.2% | 5.6% | 49.1% | 52.9% |

Precision sits at 53–58% at *every* operating point. Classics span **longer** than generic roots, not shorter:
`paulgraham.com/greatwork.html` is resubmitted over years and every submission is about that essay. At the only
threshold that catches most front doors it silences 56 of 57 classics. Publication date, `og:type`, burstiness and
traction concentration were measured too and each silences between 32% and 78% of real pages. **None of them are in the
rule**, and `FrontDoor.test.ts` asserts that time spread stays out.

## The rule, and why it takes two signals

```
FrontDoor := isRootish(address)
         AND ( meanPairwiseTitleJaccard <= 0.35  OR  any title reports an outage )
```

- **Path shape** is the strong signal and its cost is that 5.9% of real pages are rootish — Show HN launches where the
  homepage *is* the item, plus two classics (`grugbrain.dev`, `sicpdistilled.com`).
- **Title divergence** catches what path shape cannot judge: five submissions of `bankofamerica.com` carry five
  different titles because they describe five different events. Alone it fails on `danluu.com`, whose essays get
  retitled by submitters (0.366 over eight submissions).

They are complementary in exactly the right way. Root-scoping neutralises danluu — a deep path is never judged. Title
agreement neutralises the Show HN homepage — one title, repeated. Ablated on the same corpus:

| | front doors hidden | real pages silenced | classics |
|---|---|---|---|
| **full rule** | **68.8%** | **0** | **0** |
| − root scoping | 78.0% | 1.9% | 3 |
| − title agreement | 79.4% | 0.5% | 1 |
| − incident clause | 63.8% | 0 | 0 |
| + `span ≥ 365d` | 62.4% | 0 | 0 (pure loss) |

**0.35 and not 0.5.** On full retrieval 0.5 looks free. It is not: in the live top-50 relevance window the connector
actually gets, `sicpdistilled.com` collapses from five submissions to two and its agreement falls 0.526 → 0.400. Every
threshold at or above 0.40 silences a classic in production. Margin to the nearest classic: 0.176 on full retrieval,
**0.050 live**.

**The incident clause is what catches the example the product owner gave.** Live, `facebook.com` returns "Facebook-owned
sites were down" and "Facebook was down" — agreement 0.50, above threshold. `github.com` returns four submissions all
titled "GitHub is down" — agreement 1.000. Both are caught only by the six-word lexicon
(`down|outage|offline|502|503|504`), guarded by a Show/Ask/Tell/Launch HN prefix check. The first draft of that lexicon
had `read-only` in it and fired on a genuine Launch HN whose product does read-only debugging; narrowing removed the
defect for 0.7 points of recall.

## Thirty days is a domain restriction, not a TTL

A Discussion posted inside the horizon is drawn normally **whatever the verdict says, because the verdict is not
consulted for it**. "I don't want to miss a page discussed the moment it is discussed" is therefore not a risk being
mitigated — it is outside what the rule can reach. Seven days hides marginally more (75.9% against 72.3%); thirty is
chosen for the reader, because a Show HN launch thread is still *the* conversation about that homepage a month later.

## Why this is permitted at all under ADR 0005

ADR 0005: a mechanism that silently hides Discussions is worse than one that costs requests, because a false negative is
invisible to the reader. Four things answer it, and all four are load-bearing:

1. **It folds; it never deletes.** A mistake costs one click, not a disappearance. This is what makes a 0.05 live margin
   survivable.
2. **The count and the reason are in the sentence.** "8 Discussions link to this address, and they describe it
   differently each time" is a claim a reader can open and judge. "Some conversations were hidden" is not.
3. **It is visible on the surface reachable from every page.** On a front door with nothing fresh the mark never
   appears, so the toolbar surface is where it fires and where it is drawn.
4. **There is a switch.** *Show every Discussion, even on site front pages*, off by default. On, the rule is not
   consulted at all.

The toolbar badge carries no count on a Front Door with nothing fresh: a number there is a promise that opening it shows
that many conversations about the page in front of you, and "26" on `facebook.com` is a promise the panel cannot keep.

## The negative memory, and the asymmetry that makes it safe

The verdict is remembered, keyed on the Subject — and because the rule only ever fires on a rootish address, **every key
is a host**. That is what makes the shipped form cheap: ~100k hosts at about 125 KB, which is a Bloom filter's natural
shape and the negative twin of the Discussion Index ADR 0005 keeps off the gate path.

**ADR 0005 forbids gating on a positive index because its failure mode is a silent false negative — a Lookup that never
fires and that nobody can complain about. This store's failure mode is the mirror image and self-corrects within one
Lookup:** a wrong entry renders the fold on a page that is not a front door, the Lookup answers a moment later, the rule
is re-derived from the real Discussions and the panel un-folds. It can never cause a Lookup to be skipped, because:

- **It never gates a Linked Lookup.** That is the one that finds the Discussions the panel exists for. Hacker News
  Algolia is keyless, CORS-open and free; there is nothing to save and everything to lose.
- **What it may gate is the Topical Lookup** — a title search for "Facebook" issued on `facebook.com`, which is
  guaranteed noise — and **X's disclosure argument when it rests on stale Linked Mentions**. Both land in Coverage as a
  `front-door` Withholding with words the panel renders, exactly as the other eight reasons do.

Re-derivation is free: the rule's only inputs are titles and timestamps, both already in the answer. So every answer
recomputes the verdict and either overwrites the memory or takes the entry off. On top of that, a `rulesVersion` stamp
(no judgement outlives the code that made it) and a 90-day wall-clock ceiling, both of which cost nothing.

**A Silence never writes a judgement.** A Silence is evidence that nobody discussed the page — the opposite of evidence
that the page is an entrance. Conflating them would let one quiet week on `newsite.com` mark it permanently.

**Keys are concealed.** A verdict is only ever written after an Enquiry on that address, so the set of them is a list of
sites the reader opened. It is keyed through `OpaqueKeys` exactly as the Lookup Record is, and cleared by "forget
everything" alongside it. `Recollection` keys in plaintext for the opposite reason — it is built from links the reader
*saw* — and that contrast is the whole argument.

## Consequences

- New reader-visible behaviour on site front pages; no reader-facing vocabulary added. Copy uses **Discussion** only.
- One new `WithholdingReason` literal, `front-door`, in the otherwise-finished `@parle/domain`.
- `mayAskX` takes an optional `Standing`. Absent means the prior behaviour, so a first visit — where no verdict exists
  yet — is never punished for the absence of one.
- The rule lives in `@parle/policy/FrontDoor.ts`: pure, no I/O, and applied at panel assembly rather than in
  `LookupPolicy`. We still ASK; we decide what is worth showing.
- **Known cost, measured live and not hidden**: product landing pages score lower on the live top-50 window than on full
  retrieval, so `duckdb.org` (0.231), `bun.sh` (0.250), `zed.dev` (0.230), `tailwindcss.com` (0.315) and `obsidian.md`
  (0.187) are judged Front Doors in production where full retrieval would have shown them. Their Show HN threads are one
  click away rather than on screen. The threshold was measured on a 792-page corpus and is not being re-tuned on a
  40-page spot check; the divergence is a retrieval problem and is recorded below.
- **The retrieval gap is a separate, larger bug.** 133 of 401 probed pages render nothing today because the connector's
  top-50 relevance window contains no exact match — `github.com` has 1,973,951 url-matching hits and zero exact in the
  window. 63.6% of those are front doors, so most of this problem is *already* suppressed by an undisclosed retrieval
  limit rather than by a rule anyone chose. That is ADR 0005's failure happening in retrieval, invisible in the toolbar,
  and it deserves its own reckoning. Fixing it makes this rule more necessary, not less.
- **The safety evidence is thin and should be widened.** The rule can only touch the rootish real pages in the corpus —
  35 of 591 — of which 27 have a single submission. Seeding 150+ Show HN homepage launches and re-running is the
  highest-value follow-up.
