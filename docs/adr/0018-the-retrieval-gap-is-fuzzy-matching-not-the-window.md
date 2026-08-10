# The retrieval gap is fuzzy matching, not the window — and what the window still costs is disclosed

The QA sweep behind [ADR 0017](./0017-front-doors-fold-old-discussions-and-are-remembered.md) closed with a warning
that the retrieval gap was bigger than the front-door rule: *"4 of 8 known-discussed pages and 6 front doors returned
nothing because of the top-50 window. It is an undisclosed silent false negative on both sides."*

Measured against live Algolia with the exact query the connector issues, **the top-50 window was the wrong suspect.**
None of the five named pages was truncated. Raising `hitsPerPage` from 50 to 1,000 recovers **nothing** on real pages.
What *was* costing us real, high-value Discussions is a parameter nobody had looked at: **Algolia's typo tolerance,
applied to a URL query, silently returns zero hits for pages carrying thousands of points.**

So this ADR does three things. It names what the gap actually is and fixes it. It records the measured cost of the
fixes that were proposed but do not pay. And it discloses the part that remains, because ADR 0005 requires that a
mechanism which hides Discussions never be silent.

## 1. The five named pages: none of them was the window

Each run through the shipping connector against live Algolia.

| page | what actually happened |
|---|---|
| `blog.rust-lang.org/…/Rust-1.81.0.html` | **Answered, 2 Discussions.** `nbHits: 2`, both exact, at ranks 0 and 1. The connector finds it today and would have found it then. The sweep row was a measurement artefact, not a retrieval gap. |
| `sqlite.org/whybytecode.html` | **Alias mismatch.** The 790-point thread was submitted under `sqlite.org/**draft**/whybytecode.html`; SQLite later moved the document out of `/draft/`. `Address.matchingAddress` drops it, correctly — a different path is a different document until something says otherwise. No retrieval parameter reaches this. |
| `arstechnica.com/gadgets/2024/07/a-new-linux-kernel-release/` | **404. The URL does not exist.** |
| `theguardian.com/technology/2024/jul/19/crowdstrike-outage` | **404.** The real thread is under `/technology/**article**/2024/jul/24/crowdstrike-outage-companies-cost`. |
| `jvns.ca/blog/2023/09/19/when-your-coworker-does-great-work/` | **404.** The real thread — 1,074 points — is under `/blog/**2020/07/14**/when-your-coworker-does-great-work-**tell-their-manager**/`. |

The sweep hand-picked "r/programming-shaped" URLs because Reddit's front page 403s from that machine, and said so. Three
of the eight it invented do not exist. A Silence about a page that was never submitted is the connector working.

**Correcting this matters more than it looks.** The failure it reported was real in kind — it is exactly what ADR 0005
forbids — but had we fixed the window we would have paid for it and still shipped the actual defect.

## 2. What the gap really is: typo tolerance annihilates URL queries

Algolia applies typo tolerance to a URL query the way it would to prose. On long addresses the expansion does not
widen the answer, it **destroys** it. Measured over 305 pages sampled from Algolia's own index across 2010–2026 at
three popularity strata — every one of them therefore known to have been submitted:

```
                                                              typo on   typo off
raspberrypi.org/blog/raspberry-pi-400-the-70-desktop-pc/   2,594 pts   nbHits 0  ->  1
redhat.com/en/blog/red-hat-ibm-creating-leading-hybrid-…   2,611 pts   nbHits 0  ->  1
raspberrypi.org/blog/raspberry-pi-4-on-sale-now-from-35    2,504 pts   nbHits 0  ->  1
avc.com/a_vc/2011/06/enough-is-enough.html                 1,032 pts   nbHits 0  ->  1
```

Not a truncated answer and not a mis-ranked one. A flat `nbHits: 0` — *"Hacker News has never seen this page"* — about
pages with thousands of points. This is the invisible false negative in its purest form: the reader is told nothing was
found, and there is no surface on which that could be questioned.

Over the whole corpus, `typoTolerance=false`:

- **recovered 4 of 305 pages (1.3%) that returned absolutely nothing**, and
- **regressed 0 of the other 301**, and
- shrank the fuzz on 16 more.

`typoTolerance=min` and `=strict` are **not** enough — both still return zero on all four. Only `false` recovers them.

It is also strictly *more* accurate. The false positive this connector's header is built around — item 40802874,
submitted under `d41586-024-02082-5`, returned for a query about `d41586-024-02012-5` — is one of the hits typo
tolerance was inventing. With it off, six hits become five and all five are exact.

**And it costs nothing in ADR 0014's currency.** No extra request, no extra byte, no measurable latency: 439 ms against
508 ms on `github.com`, inside the noise. This is the rarest kind of change — pure recall, free.

It is applied only to the URL search. The title search keeps typo tolerance, because a title is prose typed by a human,
which is the case the feature is for.

## 3. The fixes that were proposed and do not pay

Every option in the brief, measured rather than assumed. Requests are the currency ADR 0014 cares about, because Hacker
News' 10,000/hr ceiling is metered against the **reader's own IP**.

| option | recall on 305 known-discussed pages | requests | latency / bytes |
|---|---|---|---|
| **`typoTolerance=false`** | **+4 pages, −0** | **×1** | none measurable |
| `hitsPerPage` 50 → 1,000 | **+0 pages.** 3 pages lose submissions at 50, all three front doors (`facebook.com`, `stripe.com`, `swift.org`) | ×1 | ordinary article: **no change at all** (5.5 KB, 266 ms at both). Front door: `github.com` 75 KB / 410 ms → **1.24 MB / 813 ms** |
| paginate past the window | +0. The three truncated pages lose submissions at ranks 332, 700 and 987 — a second page reaches rank 99 | ×2 and up | as above, per page |
| more of the Subject's Aliases | already 4 (`MAX_ADDRESSES`), and the one real Alias failure — `sqlite.org/draft/` — is a *missing* Alias, not an unasked one | ×N | linear in addresses |
| drop `restrictSearchableAttributes=url` | 64/64 pages, +1 submission over `typoTolerance=false` alone | ×1 | +20% bytes, and it scores title text into a window meant for addresses |
| `/search_by_date` | identical recall to `typoTolerance=false`; sorts by date, so it truncates *worse* on popular pages | ×1 | no change |

The shape of this is worth stating plainly, because the average hides it: **`hitsPerPage` is free on 98% of pages and
expensive on the 2% where it would matter, and on those 2% what it buys is front-door noise that ADR 0017 immediately
folds out of sight.** Paying 1.24 MB to recover Discussions we then hide is the worst trade on the table.

So the window stays at 50, and `attributesToRetrieve` is left alone. Neither is defended as obviously right — both are
now defended by numbers, which is the difference.

## 4. What remains, and is therefore disclosed

With typo tolerance off, **1.6% of discussed pages (5 of 305) still fill the window**, and 3 of those genuinely have
more behind it. That residue cannot be removed at a price worth paying, so under ADR 0005 it must be **said**.

`Consultation` gains `windowed` on the two cases that can carry it:

- **`Answered` windowed** means *at least* this many. The panel says `at least 12 found` and adds one sentence under the
  rows: *"Hacker News had more here than Parle reads in one go, so this is at least this many, not all of them."*
- **`Silence` windowed** is the dangerous one. `github.com` returns 50 hits out of 1,973,692 and not one of them is the
  front page — which renders, unqualified, as the same word a page nobody has ever submitted gets. It now reads
  `nothing this far in`, and the sentence appears on the page where the reader is otherwise being told nobody has
  discussed it.

**A windowed Silence is never cached.** This is the half of the fix that has nothing to do with the screen. `LookupRecord`
would have written it and `silenceTtl` would have believed it, turning one truncated answer into the settled account of
the page — a silent false negative that is then *durable*. It is dropped from the store entirely rather than given a
shorter TTL, because a shorter TTL still asserts the claim, only for less time. A windowed `Answered` is still cached:
it found real Discussions, and its absence is not what would be re-derived from it.

**Only the URL search reports a window, and it took a real Chrome to learn why.** The first build disclosed the title
search too, on the reasoning that the reader is not owed a different standard for the weak tier. In a browser that put
*"this is not all of them"* on `danluu.com/everything-is-broken/` — three Discussions, no gap worth naming. Measured
after: **a title search fills its thirty-hit window on 42% of pages** (5 of 12 real titles; "Everything is broken" 471
hits, "How to do great work" 3,413, "Red Hat and IBM" 208). It is also the wrong claim. The URL search asks *which
Discussions were submitted under this address*, and its answer either is or is not all of them. A title search asks
*what else has been said about this subject matter*, takes the top thirty by relevance **on purpose**, and is already
drawn under the words "matched by title — not provably this page". It is a sample by design, not a truncated census.

`windowed` is an absent key rather than `false` when the answer was whole. Sixty-odd existing construction sites mean
"the window was not the limit", which is what an absent key already says; a required boolean would have made every one
of them assert something none of them had measured. Connectors that cannot know — Reddit's HTML scrape reports no total
— say nothing rather than claiming completeness.

## Consequences

- **The disclosure must stay rare or it becomes wallpaper.** 1.6% is the measured rate and there is a test asserting the
  ordinary page says nothing. If a future change makes it common, that is a signal the window is wrong, not that the
  sentence should be softened.
- **A windowed Silence now costs a repeated Lookup on every visit** to the handful of pages that produce one — almost
  all of them site front doors, which is where the reader's budget is least well spent. Accepted knowingly: ADR 0005's
  whole argument is that a request is a visible cost and a false negative is not.
- **The redirect class is the bigger hole, and this ADR does not close it.** Verifying the four recovered pages in a
  real Chrome, two of them never arrived: `raspberrypi.org/blog/…` 301s to `raspberrypi.com/news/…` and
  `avc.com/a_vc/2011/06/enough-is-enough.html` to `avc.com/2011/06/enough-is-enough/`. Both land on a **different
  Subject** whose address nobody submitted, so a connector that is now perfect finds nothing. The ADR 0017 sweep saw the
  same thing on `netflix.com`, `microsoft.com`, `gitlab.com` and `stackoverflow.com` and filed it under front doors; it
  is not a front-door problem. Together with `sqlite.org/draft/` this is one hole — **the address the reader lands on is
  not the address the Discussion was submitted under** — and it is now the largest known source of silent false
  negatives in the strong tier, larger than anything measured here. `e2e/window.e2e.ts` reports it as a note rather than
  a failure, so it stays visible instead of being tuned away.
- **`sqlite.org/draft/` is not fixed and is not disclosable.** We cannot report a Discussion under an Alias we do not
  hold and do not know exists. The honest statement is that Linked Mentions are as complete as the Alias set, and the
  Alias set grows from redirects the reader's own browser traverses. A publisher moving a document breaks the link
  silently. This is the largest remaining hole in the strong tier and it needs its own work.
- **The four recovered pages are permanent live tests** (`PARLE_LIVE=1`). They are the only place the claim is
  checkable — a recorded fixture would replay the answer we already decided to ask for. If they go red, the connector is
  telling readers that discussed pages are undiscussed.
- **`nbHits` is now read from Algolia's answer** and is optional and nullable, so Algolia dropping an advisory field
  degrades the disclosure rather than turning a good answer into a Garble.
- **The corpus method is reusable and should be reused.** Sampling submitted URLs out of Algolia's own index gives a set
  of pages that are *known* to be discussed, which is the only ground truth available for a recall question. The
  hand-picked list is what produced three 404s and a wrong conclusion.
- **A live browser check is not optional for a change like this.** Everything in this ADR passed 1,300 unit tests and
  56/56 e2e before a real Chrome showed the disclosure firing on an ordinary danluu article. `e2e:window` is kept for
  that: three claims, five real pages, the real Algolia endpoint. It is deliberately outside `pnpm e2e`, because a suite
  that fails when a publisher changes a URL teaches everyone to ignore red.

## Triggers to revisit

Algolia changing its typo behaviour on the `url` attribute — the live tests are the tripwire. The windowed-answer rate
rising materially above 1.6%. A source of Aliases good enough to close the `sqlite.org/draft/` class, at which point the
window's residue is worth re-measuring against a stronger baseline.
