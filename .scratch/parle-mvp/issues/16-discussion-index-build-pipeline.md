# How is the Discussion Index built, sharded, and kept current?

Type: grilling
Status: open
Blocked by: 13, 14

## Question

Blocked on ticket 13 (the artifact contract this must produce) and ticket 14 (whether Reddit coverage exists at all).

- **Sources and merge.** Hacker News via Algolia, Reddit via whatever ticket 14 establishes. How do they merge into one index, and does the index record *which* Network knows about a URL or only that someone does?
- **Canonicalization at build time.** Must be byte-identical to the client's, per ticket 06. How is that guaranteed rather than hoped for — shared package, shared test vectors, or both?
- **Cadence.** [ADR 0005](../../../docs/adr/0005-offline-prefilter-before-any-network-lookup.md) notes freshness bounds discovery, making cadence a product decision. How often does a full rebuild happen, how often a delta?
- **Incremental updates.** Bloom filters do not support deletion. What happens as the index grows — periodic full rebuild, generational filters, something else?
- **Alchemy and Cloudflare shape.** Which primitives — Workers, cron triggers, R2, KV, Queues, Durable Objects — and how is that expressed in Alchemy per [ADR 0002](../../../docs/adr/0002-stack-effect-v4-alchemy-wxt-cloudflare.md)? What does a full rebuild cost, in time and money?
- **Self-hosting.** [ADR 0010](../../../docs/adr/0010-agpl-3.0-throughout.md) means someone must be able to run this whole pipeline in their own account. What do they need — credentials, archive downloads, budget — and is that documented as a first-class path or an afterthought?
- **Bootstrapping.** The first build has no prior state and the largest input. Does it work within Workers' execution limits, or does it need a one-off local run?

**The decision:** the pipeline's architecture, cadence, and infrastructure definition.
