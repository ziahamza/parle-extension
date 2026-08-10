# The title search is deleted, not improved

The product asked each Network two questions about every page: *has anyone posted this address* (the
Linked Lookup) and *has anyone discussed something with this title* (the Topical Lookup). The second one
is gone.

## What it looked like

On `dash.cloudflare.com`, under the heading "On this topic — matched by title, not provably this page":

```
Show HN: I'm writing a book – Cloudflare for Speed and Security   20 points   2 comments   2y
Ask HN: Is the Broken Web Costing Lives?                           7 points   1 comment    4y
Show HN: Ray Hosting – Topology-aware game server orchestrator      3 points   0 comments   1mo
Show HN: GibleArt – Transform Your Photos into Ghibli-Style Art     1 point    0 comments   16mo
```

On `example.com`, nine rows including "Ask HN: Best registrar only and why" and "Examples of Domain
Specific Languages in Clojure".

Neither list has anything to do with the page in front of the reader. This was not a tuning problem.
The evidence the tier rested on was "a keyword search on this page's title returned this thread", and
that is not evidence about the page at all — it is evidence that two strings share words.

## Why the caption was the tell

The panel drew that group under "matched by title — not provably this page". That caption was written
carefully and honestly, and it was the argument for deleting the feature: **a caption that apologises
for the rows beneath it is the product admitting the rows should not be there.** No wording fixes rows
that should not exist. ADR 0006 says the Digest reports rather than adjudicates; the same standard
applies to the panel, and a row the panel has to disclaim is a row it should not draw.

## What the deletion bought

It is unusual for a removal to pay this well. The title search was the only thing in the product that:

- **needed the page's TITLE.** Every Lookup is now keyed on the address alone. That deletes the entire
  class of defect the battle battery caught as P3 — a Topical Lookup firing before `<title>` parsed sent
  Chrome's placeholder, the raw URL, to Algolia as a search query, re-leaking the parameters the
  canonicalizer had just stripped. The wire guard, the `no-title` Withholding, the `retitle` initiative
  and its re-fire path were all built to make that safe. They are gone with the thing they guarded.
  **A defect class removed beats a defect class defended.**
- **doubled the request count.** Six Places per page became three. ADR 0014 meters the reader's own IP,
  so this is the single largest reduction in what the product spends on someone's behalf.
- **gave the front-door rule its job.** ADR 0017's `front-door` Withholding existed to stop a title
  search for "Facebook" running on `facebook.com`. With no title search there is nothing to withhold.
  The rule survives where it earns its place — the panel still FOLDS a front door's old Discussions,
  which is a display decision about answers we already have, not a refusal to ask. `front-door` remains
  a Withholding reason for X's disclosure gate alone (ADR 0001).
- **made a `Question` necessary.** A `Place` was a Network and a Question; it is now just a Network, and
  the panel's account reads "Hacker News" rather than "Hacker News · by address". A single-valued field
  is not a distinction.

`Mention` keeps two tiers, Linked and Passing, and both now rest on the same kind of evidence: somebody
wrote this address down. That is the whole claim the product makes.

## What it costs, honestly

A page discussed under a different address is now invisible unless one of its Aliases matches. The title
search was the only mechanism that could ever have found those, and ADR 0005 is explicit that a silent
false negative is the failure this project refuses — so this is a real cost, recorded rather than
waved away.

It is accepted because the mechanism did not actually deliver that. Across the QA corpus the title
search's contribution to pages that were genuinely discussed was already covered by the address search;
what it added on top was the noise above. A recall mechanism whose measured yield is noise is not recall.

If it comes back, it comes back as something with better evidence — matching on the page's canonical
address as published by the site, or on a content hash — and not as a keyword search.

## Status

Accepted, 2026-08-11. 1,302 unit tests, 20/20 typecheck. Verified in a real browser: `example.com` went
from nine irrelevant rows to none, `paulgraham.com/greatwork.html` still draws all seven of its
Discussions, and the account went from seven Places to four.
