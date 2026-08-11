# Map: Parle — discovery + fact-check browser extension

## Destination

A complete, buildable product spec for Parle covering both halves of the product — **discovery** (what has the internet already said about this page) and **fact-check** (select a passage, interrogate it) — with the **backend-free MVP** scoped tightly enough to hand straight to implementation.

The MVP is: a Chrome + Safari/iOS extension that works with **no backend deployed, no index, and no login**. Reaching the end of this map means nothing is left to decide before someone builds it.

## Notes

**Domain**: browser extension; social discussion discovery; AI summarisation and fact-checking.

**Skills every session should consult**: `/grilling` and `/domain-modeling` for every ticket unless its `Type:` says otherwise. Read [CONTEXT.md](../../CONTEXT.md) before using any domain term — the glossary is opinionated and the `_Avoid_` lists are enforced. Read the [ADRs](../../docs/adr/) before proposing anything architectural; twelve decisions are already locked and several were reversed once already.

**Standing preferences for this effort**:
- Recommend an answer with every question. The user decides; you argue your case once, then record their decision without relitigating it.
- Completeness of the reading experience beats theoretical purity. A mechanism that silently hides Discussions is worse than one that costs requests — false negatives are invisible to the user, and that is the failure mode this project keeps choosing against.
- The client must work with the backend absent. Any proposal that makes the backend load-bearing is wrong by construction ([ADR 0011](../../docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md)).
- Verify facts about third-party APIs, store policies, and platform limits rather than asserting them. Several decisions here turned on measurements (Reddit 403s datacenter IPs; HN's Algolia API is CORS-open; Chrome for Android has no extensions; iOS no longer needs Xcode). Assumptions in this space go stale fast.

**Two tracks, independent**: the **client track** (tickets 01–09) has no backend dependency and is the MVP. The **backend track** (tickets 10–15) can be built, tested, and shipped in parallel at any time; nothing in the MVP waits on it. The only join is the artifact contract (ticket 10).

## Decisions so far

<!-- one line per closed ticket; charting produced the ADRs below, not tickets -->

Charting produced twelve architecture decisions before any ticket was opened. They are the input to this map, not its output:

- [ADR 0001 — X via the user's own session](../../docs/adr/0001-x-access-via-user-session.md) — automatic and on by default on every platform, bought back with runtime gating (X only after HN or Reddit found something), hard caching, strict pacing, a kill switch, and plain disclosure. A build flag can compile X out if a store rejects it.
- [ADR 0002 — Stack](../../docs/adr/0002-stack-effect-v4-alchemy-wxt-cloudflare.md) — Effect v4 beta, Alchemy v2 beta, WXT, Cloudflare, pnpm + Turborepo monorepo. Both betas are an accepted, ongoing upgrade cost.
- [ADR 0003 — Platform targets](../../docs/adr/0003-platform-targets.md) — Chrome and Safari (macOS + iOS) ship together in v1. MV3 everywhere, no direct `chrome.*` calls. "Android" means Firefox for Android, later.
- [ADR 0004 — AI is an upgrade, not a dependency](../../docs/adr/0004-ai-is-an-upgrade-not-a-dependency.md) — discovery is free and loginless forever; the Digest needs a Provider, with "Log in with ChatGPT" (Codex OAuth) as the headline path.
- [ADR 0005 — Look everything up, minus an Exclusion List](../../docs/adr/0005-offline-prefilter-before-any-network-lookup.md) — the prefilter becomes a gate only once exhaustive, because a partial prefilter hides Discussions silently. Arriving from a Network needs no Lookup at all.
- [ADR 0006 — The Digest reports, it does not adjudicate](../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md) — it may flag a claim contested, but every flag must cite a specific Discussion and link to it.
- [ADR 0007 — Shared Digests gated by popularity](../../docs/adr/0007-shared-digests-are-gated-by-popularity.md) — popular Subjects get a Shared Digest we generate and cache; everything else is a Local Digest that never leaves the machine.
- [ADR 0008 — Design both, ship discovery first](../../docs/adr/0008-design-both-features-ship-discovery-first.md) — fact-check is designed in this effort and shipped as v2, which obliges v1 to a streaming Provider, a conversation-capable panel, and selection-owning content scripts.
- [ADR 0009 — Audience spread, not outlet ratings](../../docs/adr/0009-audience-spread-not-outlet-ratings.md) — report where a page travelled; do not rate publishers.
- [ADR 0010 — AGPL-3.0 throughout](../../docs/adr/0010-agpl-3.0-throughout.md).
- [ADR 0011 — The client is autonomous, the backend is an accelerator](../../docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md) — all Network connectors live in the client; the backend never sits between client and Network. Reddit 403s datacenter IPs, so the client is the *stronger* path, not merely the more resilient one.
- [ADR 0012 — Local Discussion Cache built from browsing](../../docs/adr/0012-local-discussion-cache-built-from-browsing.md) — harvesting the Networks the reader already uses builds a personal index that makes lookups instant *and* discloses less.
- [ADR 0013 — Reddit connector is tiered, login optional](../../docs/adr/0013-reddit-connector-is-tiered-with-optional-login.md) — `.json` with credentials → `old.reddit` HTML search → silent degrade. The optional "Connect Reddit" login was removed by ADR 0014.

Then the research sweep of 2026-08-08 resolved four tickets. Full findings live in [research/](./research/):

- [Reddit access path](./issues/01-reddit-access-path-spike.md) — **works from the browser**, and the cause we recorded was wrong: **cookies** gate `.json` (403 on `omit`, 200 on `include`, same browser, same second) while **IP reputation** gates HTML. An anonymous cookie jar suffices — no Reddit account needed. But Reddit announced on 2026-05-28 it is closing unauthenticated `.json`, and named RSS as next.
- [Reddit corpus](./issues/14-reddit-corpus-sourcing.md) — buildable from archives, but **every one is licence-silent**, with a 13-month hole (2023-03→2024-03) and ~750M URLs. Hacker News by contrast has a clean **ODC-BY** dataset. The index ships **HN-only** for v1.
- [Artifact contract](./issues/13-artifact-contract.md) — **no sharding and no bloom filter**. A binary fuse filter over 3.58M HN keys is **4.05 MB in one file**, 0.38% false positives, 2 ms to deserialize. Because there are no shards, the shard-addressing privacy leak we worried about **does not exist**.
- [Community Notes](./issues/15-community-notes-url-join.md) — **negative**, and dropped entirely. See Out of scope.

- [ADR 0014 — No Network OAuth](../../docs/adr/0014-no-network-oauth.md) — on every Network in scope, a reader's login authenticates *them* while the quota bill lands on *us*. Hacker News has no OAuth at all and meters the reader's own IP; Reddit's is 100 QPM per client id shared across every install, saturating at ~600–800 daily active users, and registration has been approval-gated since November 2025 with one client id per account for life; X's `url:` search is genuinely capable but bills us ~$0.005 per post, about $75/month per active reader. Reddit's own wiki names a logged-in browser session as a **separate accepted form of identification** not metered against a client id — so OAuth would move us *off* an unmetered path *onto* a metered one. What the login was reaching for is delivered instead as opt-in toggles and plain disclosure.

Two further decisions taken the same day:

- **The product will be renamed.** Three live products already brand as "Parlé" (one a dev-tools/AI product), there is a standard-character Class 9 trademark on the word, search is unwinnable against a ~$2.2B biscuit brand, and Parler adjacency invites the "is this Dissenter again?" reading from store reviewers — Dissenter being a browser extension in this exact category that was removed from both the Chrome Web Store and Firefox AMO. Name selection is running; see [ticket 09](./issues/09-naming.md).
- **Explicit Network logins are welcome**, not merely tolerated — the product owner's position is that an authorized login beats riding ambient session cookies. Hacker News has no OAuth and nothing behind one (Algolia is already open and keyless), Reddit's is real and already adopted in ADR 0013, and X's is under investigation because the decisive question is whether a login spends the *user's* entitlement or *our* paid app tier.

## Not yet specified

In scope, but not yet sharp enough to ticket. Graduates as the frontier advances.

- **Fact-check design** — the whole second half of the product, and at least as large as everything charted here. Blocked on the panel and Provider seams landing (tickets 05, 07) before its questions can be phrased precisely. Will resolve, at minimum: what a Claim is and how a selection maps to one; where verdicts are sourced and whether they may ever be model-authored given [ADR 0006](../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md); how it fails safely; who pays for it; and how it applies to a YouTube transcript. Expect this patch to graduate into several tickets, not one.
- **Digest quality and evaluation** — how we know a Digest is good, and how we detect regression when the prompt or model changes. Can't be specified before a Digest prompt exists (ticket 12).
- **Analytics at all** — whether this project collects any telemetry whatsoever, and if so how that survives a privacy-first positioning. Currently unresolved in both directions; the default in the absence of a decision is none.
- **Promoting the Discussion Index from optimisation to gate** — [ADR 0005](../../docs/adr/0005-offline-prefilter-before-any-network-lookup.md) sets the bar at exhaustive coverage across every Network. What "exhaustive enough" measurably means is unknown until Reddit corpus sourcing (ticket 11) reports.
- **Onboarding and disclosure copy** — partly covered by ticket 14, but the first-run experience as a whole (what we explain, in what order, before the first Lookup fires) is not yet designed.
- **Growth and distribution** — how anyone finds out this exists. Untouched.
- **Firefox desktop and Firefox for Android** — committed to in [ADR 0003](../../docs/adr/0003-platform-targets.md) as post-v1 targets; their specific work is unspecified.

## Out of scope

Ruled beyond this destination. These do not graduate.

- **X Community Notes, in every form** — dropped 2026-08-08 after [ticket 15](./issues/15-community-notes-url-join.md) returned negative. The only available join (URLs cited inside note text) inverts the note's meaning ~85% of the time, and there is no licence to redistribute the dump. The semantically correct join — `tweetId` → the outbound link in the noted post — was considered as a follow-on spike and **also ruled out**, to keep the scope closed rather than leaving a thread hanging. See [ADR 0006](../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md).
- **Licensed outlet bias ratings** (AllSides / MBFC / Ad Fontes style) — a data-licensing and editorial-legitimacy problem with almost no shared architecture. Superseded by Spread; see [ADR 0009](../../docs/adr/0009-audience-spread-not-outlet-ratings.md).
- **Pages discussed only on X** — unreachable without an X corpus, which cannot be enumerated. Accepted blind spot; see [ADR 0005](../../docs/adr/0005-offline-prefilter-before-any-network-lookup.md).
- **YouTube comments as a Network, transcript-based debunking, and counter-video discovery** — YouTube is in scope only as a Subject. The rest follows fact-check, as a later effort.
- **A hosted free-tier AI service** — rejected in favour of the user's own tokens; see [ADR 0004](../../docs/adr/0004-ai-is-an-upgrade-not-a-dependency.md).
- **The backend proxying Network access** — forbidden by [ADR 0011](../../docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md). Connectors are client code, always.
- **The paid X API v2** — rejected twice; it would make the backend mandatory and put a permanent cost floor on the project.
