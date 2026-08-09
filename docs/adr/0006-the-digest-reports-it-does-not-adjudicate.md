# The Digest synthesizes and may flag contested claims, but every flag must cite a Discussion

The Digest presents the positions, disagreements, and strongest counterarguments found across Discussions, and **may mark a claim on the Subject as contested**. The binding constraint: a contested flag must be **evidenced by a specific Discussion and linked to it**. The Digest may report "this is disputed *here*"; it may never mark something contested from the model's own knowledge.

**Amended 2026-08-08.** This ADR originally named X's Community Notes as its exemplar — the one place the product would show adjudication without performing any, by surfacing notes verbatim and attributed. **That is dropped**, and the principle now rests entirely on Discussions. Two independent findings killed it, either sufficient on its own:

- **The join inverts the meaning.** The public dump gives note text and a `tweetId`, not the noted post's links, so the only available join is on URLs cited *inside note text*. Across 117 hand-read notes, **~82–88% of cited URLs are supporting evidence** for the correction, ~12–16% are the authentic original of misused media, and only **~1–3% are the thing being debunked** — and per-URL we cannot tell which. Showing "N Community Notes reference this page" would therefore imply a source was debunked when it was usually the evidence doing the debunking. That is precisely the false adjudication this ADR exists to prevent.
- **There is no licence to redistribute it.** `ton.twimg.com/birdwatch-public-data/LICENSE` returns 404; the Apache-2.0 licence on `twitter/communitynotes` covers the code only, and X's Developer Policy caps third-party redistribution of X Content at IDs. Shipping note text in an AGPL-3.0 project has no established permission.

The data quality was never the problem — 2,951,683 notes, 24 columns, 98.78% of rated-helpful notes carrying a URL, ~232k distinct URLs, a 273 KiB filter. It is the *meaning* of the join that fails.

## Why the citation constraint is load-bearing

Flagging a claim is the point at which the product stops describing and starts judging — and a wrong "contested" on a true article costs more trust than many correct ones earn. Requiring a citation converts the flag from an assertion into a report: we are not claiming the page is wrong, we are claiming someone said so, and here is who. That claim is checkable by the reader and cannot be wrong in the way a verdict can. It also makes the flag more useful, because the reader can go and judge the objection themselves — which is the entire point of the product.

## Considered Options

- **Pure synthesis, no flags** — never wrong, but leaves the reader to spot the disagreement themselves.
- **Full verdicts** — the AI states whether claims hold up. Most valuable and most differentiating; rejected because it makes us the arbiter, with the liability and trust cliff that follows.
- **Outlet bias ratings (Ground News-style)** — worth noting this is not a model problem at all: it needs licensed per-outlet ratings data or our own published methodology, and would ship as an independent static artifact. Out of scope for now; see the map.

## Consequences

- The Digest prompt must be built around **extraction with attribution**, not free generation: every claim in the output traces to a Discussion we actually fetched. Unciteable output is a bug.
- Digest rendering must make the citation clickable everywhere a flag appears; a flag without a visible source is not shippable.
- The word "contested" is read by most people as "false". Copy and visual treatment must work against that, not lean into it.
