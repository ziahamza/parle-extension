# The client builds its own Discussion cache from Networks the reader already uses

The extension maintains a **Local Discussion Cache**: a per-user map from Subject URL to the *existence and location* of Discussions — which Network, which thread, and cheap metadata like score and comment count. It stores **pointers, not content**. Anything fetchable on demand is fetched on demand; the cache exists so we know a Discussion is there and can go straight to it.

It is filled two ways:

- **Harvest, aggressively.** Whenever the reader is on Hacker News, Reddit, or X, every outbound link visible on the page — with the thread it came from — is recorded. Reading those Networks is itself the crawl, and we are deliberately thorough about it. **Amended 2026-08-24:** the same clause now covers Bluesky (`bsky.app`), Lemmy and Lobsters (`lobste.rs`). Lemmy is a network of instances rather than a site, and Harvest deliberately reads **more** instances than Lookup asks: Lookups go to `lemmy.world` alone, while Harvest also reads `lemm.ee` and `lemmy.ml` — reading a page the reader already has open costs no request, and `@parle/harvest`'s parser vocabulary is written against exactly that instance list. Widening the list means widening both together (`harvest.content.ts` carries the same note).
- **Prefetch, opportunistically and under a cap.** When the reader is on one of these Networks, cheaply pull a little more than is on screen — front page, top listings, their own home feed where logged in. A small amount of scheduled prefetch is permitted on top of this, governed by a **request budget with a hard daily cap** rather than a fixed interval, and never while the reader is inactive. Prefetch is occasional by design, not continuous.

On a Subject with a cache hit, results are instant and offline.

**Corrected 2026-08-09.** This originally read "…and require no Lookup at all", and that was wrong. The Local Discussion Cache is filled by Harvest, so it holds only what the reader happened to *see*: the one Hacker News thread they clicked from, not the other four about the same page, and nothing at all from a Network they were not on. Suppressing the Lookup on a hit would therefore show one Discussion and silently hide the rest — the invisible false negative this project has chosen against at every turn, and the exact failure [ADR 0005](./0005-offline-prefilter-before-any-network-lookup.md) refuses a partial prefilter for.

So a cache hit **paints first and the Lookup still runs behind it**. The cache buys latency, not a saved request. The privacy claim below survives intact — cache-*building* traffic is still independent of browsing — but the "removes a Lookup" half of it does not, and is struck.

The consequence is worth stating because it will look like an omission to anyone reading the code: there is deliberately no `already-known` Withholding reason, and adding one would be implementing a bug.

## The click-through case must be flawless

Clicking a link *from* Hacker News, Reddit, or X and immediately seeing that Discussion attached is the single experience this cache exists to make perfect. It cannot rest on the referrer: **X rewrites outbound links through `t.co` and Reddit through its own tracking redirects**, so the referrer is frequently absent or unhelpful and the URL the reader lands on is not the URL they saw.

Harvesting must therefore **resolve shortlinks and tracking redirects to their destination at harvest time**, and key the cache on the canonical destination URL. Done that way the Discussion is already attached before the click happens, with no request and no latency. Done any other way, the marquee experience is the one that fails.

## Why this leaks less than what it replaces

Cache-building traffic is **independent of the reader's browsing**. Harvesting reads pages the reader had already loaded. Prefetching a front page is the identical request every user of that Network makes, and says nothing about which URLs this reader cares about. ~~Every cache hit then *removes* a Lookup that would otherwise have disclosed a URL to a third party.~~ — struck 2026-08-09; see the correction above. The cache buys latency, and it works with no backend, consistent with [ADR 0011](./0011-the-client-is-autonomous-the-backend-is-an-accelerator.md).

It also partly reverses the accepted blind spot in [ADR 0001](./0001-x-access-via-user-session.md): links harvested from the reader's own X timeline give X coverage **with no search request at all**.

## Consequences

- The cache holds pointers and cheap metadata only. Comment bodies and anything else needed to build a Digest are fetched live when the reader asks.
- **Metadata goes stale** — scores and comment counts move. A cache hit renders immediately from cache; freshness is reconciled afterwards rather than blocking the first paint.
- Storage sits in IndexedDB with a bounded size and an eviction policy. **iOS Safari extension storage limits are materially tighter than desktop**, so the eviction policy must be sized for the iOS build, which is the constraining platform.
- The cache is a record of Networks the reader browsed, held locally. It never syncs anywhere. **Amended 2026-08-08:** "clearing it must be a visible, single action" was written when there was one store; there are two, with opposite privacy properties. The reader gets one prominent "forget everything" plus a finer control for the Lookup Record alone, whose keys are opaque. See [ADR 0015](./0015-what-is-stored-and-for-how-long.md).
- Harvesting requires content scripts on `news.ycombinator.com`, `reddit.com`, and `x.com`. Those host permissions are already needed; harvesting does not widen them. **Amended 2026-08-24:** the manifest now also names `bsky.app`, `lemmy.world`, `lemm.ee`, `lemmy.ml` and `lobste.rs`. WXT already derives `http(s)://*/*` host permissions from the pill's own match patterns, so these add a *presence* on those sites, not a permission — the distinction `harvest.content.ts` records.
- **Harvest obeys the first-run answer, and "only when I ask" means no harvesting** (decided 2026-08-09). The harvest content script is *in the manifest*, so it starts on install — and before this was enforced it was measured resolving shortlinks and writing rows to disk before the reader had answered anything, which falsified the product's own first-run promise. The argument for exempting it is real: harvesting only records links that were already on a page the reader opened themselves. But it *resolves shortlinks*, and that is an outbound request to a third party, so it is not exempt in the only sense that matters to the promise. The cost is accepted and should not be quietly clawed back: a reader in manual mode gets **no Local Discussion Cache at all**, and therefore none of the instant click-through this ADR exists for. The alternative considered and rejected was a separate harvesting switch — a third control on a settings page already carrying per-Network toggles, exclusions, pauses and two forget controls, to recover a feature for the readers who asked for less.
- Scheduled prefetch needs background execution, which **MV3 service workers terminate aggressively and iOS Safari extensions largely do not provide** when Safari is not foreground. The scheduled portion is therefore best-effort and must never be load-bearing: opportunistic harvest is the mechanism that has to work everywhere, with the cap-governed schedule as a bonus where the platform allows it. iOS behaviour here needs a device test, not an assumption.
- Shortlink resolution at harvest time costs a request per unresolved link. It must be batched, cached, and capped, or harvesting a busy timeline becomes its own traffic problem.
