# What are the packages, and what are the Effect service boundaries between them?

Type: grilling
Status: open

## Question

Unblocked 2026-08-08 — ticket 19 resolved.

**Settled already** (2026-08-08): the shared surface between the client and backend tracks is **narrow** — `packages/domain` (types, canonicalization, schemas) and `packages/index-codec` (filter encoding, shard addressing, delta format) are shared; connectors, browser layer, Provider, and cache are client-only; corpus readers and index builders are backend-only. The rationale is that the backend has no Reddit or X connector at all — it reads archives, which is a different operation wearing the same name — so a shared `NetworkConnector` abstraction would be a false one. Turborepo enforces the boundary, making independence a build error rather than a discipline.

This is how the repo starts, so it is needed on day one, and getting the seams wrong is the expensive kind of wrong. [ADR 0002](../../../docs/adr/0002-stack-effect-v4-alchemy-wxt-cloudflare.md) fixes the stack (Effect v4 beta, WXT, Alchemy, Cloudflare, pnpm + Turborepo); [ADR 0003](../../../docs/adr/0003-platform-targets.md) forbids direct `chrome.*` calls; [ADR 0008](../../../docs/adr/0008-design-both-features-ship-discovery-first.md) requires v1 to carry capability v2 will use; [ADR 0011](../../../docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md) requires the client and backend to build and ship independently.

- **Package graph.** What packages exist, and what may depend on what? Candidates: domain types, Network connectors, browser-API adapter, Provider service, cache, extension app, backend workers, artifact tooling. Which are shared between client and backend, given they must ship independently?
- **The browser adapter.** What is the Effect-shaped interface over storage, alarms, tabs, messaging, and content-script injection, such that MV3-on-Chrome and MV3-on-Safari are two layers behind one interface — and a third could be added for Firefox without touching callers?
- **The Network connector interface.** One interface for HN, Reddit, and X, given how differently they behave (Algolia vs cookie-bearing fetch vs private endpoints), and given [ADR 0001](../../../docs/adr/0001-x-access-via-user-session.md)'s runtime gate means X is invoked conditionally on other connectors' results. Where do rate limiting, caching, kill-switch, and graceful degradation live — in each connector, or in the layer above?
- **The Provider service.** [ADR 0008](../../../docs/adr/0008-design-both-features-ship-discovery-first.md) requires it to expose streaming multi-turn completion even though v1 only calls it one way. What does that interface look like, and how do Codex OAuth / BYOK / on-device sit behind it as layers?
- **Effect v4 specifics.** Which `effect/unstable/*` imports are we accepting, and how do we make that a visible, tracked debt rather than a surprise at upgrade time? What is the version-pinning and upgrade policy for two betas?
- **Turborepo pipeline.** Build, typecheck, test, and cross-browser extension builds in CI from the first commit, per [ADR 0003](../../../docs/adr/0003-platform-targets.md).

**The decision:** the package graph and the interfaces at each seam, concrete enough to scaffold.
