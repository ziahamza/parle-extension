# Can a Reddit URL corpus be built at all, and from what?

Type: research
Status: resolved

## Question

The Discussion Index needs Reddit coverage to be worth much — Hacker News alone only lights up on tech content. But [ADR 0011](../../../docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md) records a measured obstacle: **Reddit returns 403 to datacenter IPs**, which is exactly where a backend crawler lives. So the backend is the *weaker* Reddit path, not the stronger one.

Find out what is actually obtainable in 2026:

- **Historical archives.** What is the current state of Pushshift-derived dumps — Academic Torrents, the `arctic_shift` project, and anything newer? What date range do they cover, what size, what licence, and do they include submission URLs (which is all we need — not comment bodies)?
- **Ongoing coverage.** Historical dumps go stale, and recent Discussions are the ones readers most want. What continuous feed is available and permissible? Reddit's own listing endpoints polled from a scheduled Worker, if they answer at all from Cloudflare's IPs? A third-party mirror? Nothing?
- **The 403.** Is it IP reputation, User-Agent, TLS fingerprint, or absence of cookies? Does a Cloudflare Worker fare differently from a generic datacenter host? This determines whether *any* server-side option exists.
- **Scale.** How many submission URLs are we talking about, and what does that do to the bloom filter sizing in ticket 13?
- **Terms.** What Reddit's current API terms and `robots.txt` permit for indexing, and what the licence terms on any archive we adopt require — [ADR 0010](../../../docs/adr/0010-agpl-3.0-throughout.md) means whatever we build is published.

**The decision:** whether a Reddit corpus is buildable, from what sources, at what freshness — and if not, whether the Discussion Index is Hacker-News-only, which would set the bar in [ADR 0005](../../../docs/adr/0005-offline-prefilter-before-any-network-lookup.md) permanently out of reach.

## Answer

Resolved by the research sweep of 2026-08-08 (37 agents, adversarially verified). Full findings: [research/ticket-14.md](../research/ticket-14.md).
