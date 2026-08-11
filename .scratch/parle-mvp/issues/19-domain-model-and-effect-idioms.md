# What is the domain model, in Effect v4's actual idioms?

Type: grilling
Status: resolved

## Question

The glossary in [CONTEXT.md](../../../CONTEXT.md) was written incrementally during charting, one term at a time as decisions landed. It has never been stress-tested as a whole, and no one has checked whether its vocabulary can express the hard cases without contortion. Separately, the service interfaces this project needs were being proposed against a half-remembered picture of Effect v4 — which is a beta whose API differs materially from the v3 that most published material describes.

Both gaps have to close before ticket 05 can decide package boundaries, because a package graph is a projection of a domain model and inherits its mistakes.

**The ten hard cases** any model must express cleanly:

1. Three-wave arrival — Local Discussion Cache, then HN + Reddit, then X gated at runtime on the earlier waves ([ADR 0001](../../../docs/adr/0001-x-access-via-user-session.md))
2. Degradation as a state, not an error ([ADR 0011](../../../docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md))
3. Linked Mention and Topical Mention never blending
4. Cache/live reconciliation when the fresh answer disagrees with the cached one
5. A Digest crossing from Local to Shared without the reader noticing ([ADR 0007](../../../docs/adr/0007-shared-digests-are-gated-by-popularity.md))
6. ~~Watermark and Delta as a reader feature~~ — **removed 2026-08-08.** A Digest is the current summary of the whole discussion, rewritten as it grows; the reader never sees a diff. The Watermark survives as internal rewrite-triggering machinery only.
7. A contested flag that cannot be constructed without its citation ([ADR 0006](../../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md))
8. Harvest, including resolving `t.co` and tracking redirects at harvest time ([ADR 0012](../../../docs/adr/0012-local-discussion-cache-built-from-browsing.md))
9. Provider swap, with v1 already carrying the streaming multi-turn capability v2 needs ([ADR 0008](../../../docs/adr/0008-design-both-features-ship-discovery-first.md))
10. Client and backend sharing only what must agree byte-for-byte

**The decision:** a glossary that survives adversarial stress scenarios, and a service decomposition expressed in Effect v4 primitives that actually exist — plus an explicit list of what we are taking on from `effect/unstable/*`.

## Comments

**2026-08-08** — Charting proposed a `Stream<DiscoveryEvent>` shape for the Discovery service. Withdrawn before it was decided: it was reasoning from familiarity rather than from either the domain or the v4 API surface. Running instead a four-lens panel of competing domain models (event, aggregate, capability, evidence/provenance), judged from three angles, then broken against adversarial scenarios in three areas — alongside a six-area empirical exploration of Effect v4 built against the installed beta rather than from memory.

## Answer

**Resolved 2026-08-08.** Four independent domain models (event, aggregate, capability, evidence/provenance lenses) were judged from three angles and broken against adversarial scenarios in three areas, alongside a six-area empirical exploration of Effect v4 built against the installed beta. Full material: [research/ticket-19-domain-model.md](../research/ticket-19-domain-model.md).

**The aggregate lens won** — the only model whose ADR 0006 defence survived. Twelve defects were found, most verified by execution rather than argument. The five that changed the design:

- **The citation invariant was decoration in three of four models.** A check closing over the payload's own source list is satisfied by a Provider that fabricates a source *and* a citation naming it. Fixed by supplying the Brief out of band as a **decoding service**, so `admit` types as `Effect<Digest, SchemaError, Brief>` and there is no way to decode model output without producing the material it was supposed to be reading. Implemented and covered by tests.
- **ADR 0001's X gate was tier-blind and used the wrong quantifier.** Only a Linked Mention discharges the disclosure argument; a Topical match leaves the address novel. And `some(...)` reported "settled, undiscussed" for the routine case where HN is silent and Reddit refuses. Both fixed.
- **Cross-Network id collision** — a Reddit permalink citing base-36 `1abc2de` was accepted against HN item `1abc2de`. Discussion identity is now the pair.
- **Runtime equality collapsed the two tiers** in the model judged best at keeping them apart. Tiers are now a tagged union with structurally different evidence.
- **`observedAt` as network time is unpopulatable** — verified against live HN Algolia. Observations carry *our* receive time.

The glossary went from 18 terms to 34, then to 32 after the Delta simplification. Service decomposition and an Effect v4 cheat sheet (with `effect/unstable/*` debt enumerated) are in sections 4 and 5 of the research file.

**Six open questions were put to the human and all six are resolved** — [ADR 0001](../../../docs/adr/0001-x-access-via-user-session.md) (explicit request reaches X), [ADR 0007](../../../docs/adr/0007-shared-digests-are-gated-by-popularity.md) (reader-facing Delta and Last Look removed entirely — a Digest is the current summary of the whole discussion, rewritten as it grows), and [ADR 0015](../../../docs/adr/0015-what-is-stored-and-for-how-long.md) (Silence TTL from Subject age, Alias re-keying on observed evidence, two stores with opaque keys).
