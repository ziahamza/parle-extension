# Can Community Notes be joined to a Subject URL, and how?

Type: research
Status: resolved

## Question

Verified during charting: X publishes Community Notes as **public daily TSV/zip dumps at `ton.twimg.com/birdwatch-public-data/…` with no authentication**. [ADR 0006](../../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md) commits to surfacing notes verbatim as other people's verdicts — the one place the product shows adjudication without doing any. It is also the most novel signal in the design, and nobody else surfaces it this way.

The obstacle is the join. The dump gives note text and a tweet ID; it does **not** give the tweet's content or its links. So "which notes concern this page" is not directly answerable.

- **Fields.** Download a current dump and establish exactly what `notes`, `ratings`, and `noteStatusHistory` contain in 2026, and note the schema has changed before (columns have been added without warning).
- **The join.** The workable path identified during charting is **URLs cited inside note text** — notes routinely cite sources. How often does note text contain a URL? What fraction of notes would be reachable this way? Is the resulting signal "this page is cited as evidence in a note" or "this page is being debunked by a note" — and can we even tell the difference, because presenting one as the other would be a serious error.
- **Status filtering.** Only notes rated helpful and currently shown should surface; the dump includes rejected and pending notes. Which fields express that?
- **Volume and cost.** Total size, daily delta size, and what indexing it costs on Cloudflare.
- **Terms.** What X's terms permit for redistributing this data in an AGPL project ([ADR 0010](../../../docs/adr/0010-agpl-3.0-throughout.md)).

**The decision:** whether a usable URL→Notes join exists, what it means semantically, and what it costs to maintain.

## Answer

Resolved by the research sweep of 2026-08-08 (37 agents, adversarially verified). Full findings: [research/ticket-15.md](../research/ticket-15.md).

**Resolved NEGATIVE, 2026-08-08.** No usable join exists. The only available one — URLs cited inside note text — inverts the note's meaning in ~85% of cases, and the dump carries no licence permitting redistribution. Community Notes is now **out of scope in every form**, including the semantically correct `tweetId` → noted-post-link spike, which was considered and also ruled out. [ADR 0006](../../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md) amended to stop naming it as the exemplar.
