# The extension is fully functional with the backend absent

Every Network connector — Hacker News, Reddit, X — lives **in the extension** and runs against the browser's own session. The backend never sits between the client and a Network. If the backend is down, unreachable, or has never been deployed at all, the extension still finds and shows Discussions.

The backend is an **accelerator** with two independent halves, each of which degrades on its own rather than taking the product with it:

- **Index artifacts** — builds and serves the Discussion Index so a client can answer "is there anything here?" offline and instantly.
- **Shared Digests** — generates and caches Digests for popular Subjects so readers without a Provider still get one.

Neither half is on the critical path for the core loop. A client with no backend, no Provider, and no login still finds Discussions and links you to them.

## Why

It is the only architecture in which "no backend required" is a true statement rather than a marketing one, and it is what makes [ADR 0010](./0010-agpl-3.0-throughout.md)'s fork-and-deploy-your-own promise real: a fork that never deploys anything still ships a working product.

It also reflects an access asymmetry we have measured. A server-side crawler is the *weaker* Reddit path, not the stronger one; the client, carrying a real browser's cookie jar, gets answers our own infrastructure cannot. Routing Network access through the backend would have made the product worse, not just more fragile.

**Correction, 2026-08-08.** This ADR originally recorded the cause as "Reddit returns 403 to datacenter IPs". That is wrong, and a wrong cause points at a wrong fix (residential proxies), so it matters. There are **two independent gates**, established by an omit-vs-include A/B in the same browser, same origin, same second:

- **Cookies gate `.json`.** `www.reddit.com/api/info.json?url=…` returns 403 with `credentials: 'omit'` *even from a good consumer IP*, and 200 with `credentials: 'include'`. A **logged-in account is not required** — an anonymous reddit.com cookie jar suffices (`/api/v1/me.json` returned 200 with no `name` field on the succeeding browser). This is a meaningful improvement on what we assumed: unlike X, the Reddit connector needs no login.
- **IP reputation gates HTML.** HTML surfaces work cookie-free from a consumer IP but 403 from a datacenter host. This gate is real, and it is what blocks CI.

Both gates are passable only from a real user's browser — the browser supplies the cookies for one and the consumer IP for the other. No server-side proxy passes either, so "proxy it through a Worker" is closed, not merely discouraged.

## Consequences

- **Connectors are client code.** Anything the backend needs from a Network it must obtain by its own means (archives, Algolia, public dumps) — it may not reach through a client, and clients are never proxies for our crawling.
- **A seed index ships inside the extension bundle** — a compact bloom filter of the most-discussed URLs, present on disk before the first page load. The full Discussion Index streams in afterwards as incremental deltas. Cold start and backend-down therefore degrade to a *stale* index, never to *no* index, so [ADR 0005](./0005-offline-prefilter-before-any-network-lookup.md)'s guarantee never has a hole in it. Worst-case staleness is bounded by the extension's own release cadence rather than by a CDN we might not control.
- Every backend-provided capability needs an explicit degraded mode in the UI. "Index stale", "Shared Digests unavailable" are states the panel must render, not errors it may throw.
- Backend and client can be built, versioned, and shipped independently. Neither release blocks the other, and the artifact format between them is a contract to be versioned deliberately.
