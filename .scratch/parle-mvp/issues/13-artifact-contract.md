# What is the contract between the backend's artifacts and the client?

Type: grilling
Status: resolved

## Question

The single join between the two tracks. [ADR 0011](../../../docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md) requires client and backend to build, version, and ship independently — which only works if the thing between them is pinned early and changed deliberately. Pin it, and both tracks run in parallel indefinitely.

- **What artifacts exist.** The Discussion Index; Exclusion List updates; the kill-switch flag [ADR 0001](../../../docs/adr/0001-x-access-via-user-session.md) requires; the popularity threshold [ADR 0007](../../../docs/adr/0007-shared-digests-are-gated-by-popularity.md) requires be tunable without a build; Shared Digests. Anything else?
- **Index encoding.** Bloom filter parameters and target false-positive rate; the size/precision trade-off; how the URL is hashed, which must agree exactly with ticket 06's canonicalization or every key silently diverges.
- **Sharding.** How the index is split so a client fetches only what it needs; how a shard is addressed; how big a shard is.
- **Deltas.** The incremental update format, how a client knows which deltas it needs, and how it recovers when it has fallen too far behind to catch up incrementally.
- **Versioning and compatibility.** An old client must tolerate new artifacts and vice versa — [ADR 0011](../../../docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md) means neither release blocks the other, so both directions of skew are normal. What is the negotiation, and what does the client do when it can't understand what it fetched?
- **Self-hosting.** [ADR 0010](../../../docs/adr/0010-agpl-3.0-throughout.md) and [ADR 0002](../../../docs/adr/0002-stack-effect-v4-alchemy-wxt-cloudflare.md) promise anyone can deploy their own and point an install at it. Where is the origin configured, and how is a self-hosted origin trusted?

**The decision:** the artifact formats, addressing scheme, and versioning policy — enough that both tracks can proceed without further coordination.

## Answer

Resolved by the research sweep of 2026-08-08 (37 agents, adversarially verified). Full findings: [research/ticket-13.md](../research/ticket-13.md).
