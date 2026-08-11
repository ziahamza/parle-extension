# Research: ticket 19 — domain model + Effect v4

All ground truth read; every primitive and every load-bearing claim verified against `effect@4.0.0-beta.105`.

# Parle — domain model and Effect v4 service decomposition

> Verification: existence probe `/tmp/effect4-probe/final/exists.ts` (every primitive cited below, deep-imported, `tsc --strict` clean) and design probe `/tmp/effect4-probe/final/design.ts` (typechecks + runs green). Ground truth re-read 2026-08-08, including the map's Community Notes removal and the resolved tickets 01/13/14/15.

---

## 1. Verdict

**Classic DDD aggregates wins the frame**, because it is the only model whose ADR 0006 defence survived the adversarial pass. When a Digest carries its own claim of what it was written from — the shape three of four models shipped — a model that fabricates a corpus entry *and* a citation naming it passes the check trivially. I reproduced that: `Digest.makeOption(fabricated)` returns `Some`. Only the aggregate lens's `admit(raw: unknown, brief)`, which takes the Brief **as a separate argument**, is non-vacuous. The same model is also the only one that split the reader's tab out of the Subject (its `Visit`, my `Reading`), which is what stops one tab's arrival evidence leaking into another's; and its tier encoding — a tagged union whose two cases carry *structurally different evidence* — is the one that survives runtime equality, where the capability lens's three nominal brands over identical fields collapse (`Equal.equals === true`, `HashSet` size 1, verified). Its sharing rule — share identities, value objects and codecs; never an aggregate root, repository, or factory — is the only principled justification anyone gave for the package boundary ticket 05 already settled.

Grafted: from **capability**, the X gate as a *total pure function* of accumulated state (the `Deferred`/`onEnd` formulation hangs forever with no error when wave 2 settles empty — three models built the product's primary volume control on it), the `NoPriorMention` vs `CouldNotEstablish` distinction, and Passing Mention; from **event**, the Lookup Record split out of the Local Discussion Cache (the only privacy defect anyone found in a written ADR), the Movement verdict vocabulary, and merge-not-concat so a slow iOS read cannot block the network waves; from **provenance**, "provenance is rendered only when it changes what a claim is worth" (one rule that derives ADR 0007's invisible crossover *and* ADR 0012's visible staleness), seams shaped so they cannot gate, and the Watermark holding numbers rather than whole Observations. Five concepts came from the stress tests and from no model: **Alias**, composite Discussion identity, **Garble**, **Enquiry** as a lifetime distinct from the Reading, and the Brief supplied out of band.

---

## 2. Proposed glossary

*Replaces CONTEXT.md's `## Language` section entirely. 34 terms, up from 18 — section 3 justifies every addition. Six are reader-facing (Discussion, Digest, Finding, Delta, Spread, Provider); the rest are engineering vocabulary and ticket 09 should say so.*

### The page being read

**Subject** *(CHANGED)*:
A web page, identified by the set of addresses believed to point at one reading of it. It exists whether or not anyone currently has it open.
_Avoid_: page, article, target, current tab

**Subject URL** *(CHANGED)*:
The one Alias elected to represent a Subject, produced by a specific numbered version of the canonicalization rules and used as the key everywhere. Two components running different rule versions produce different keys for the same page.
_Avoid_: url, link, permalink, canonical url

**Alias** *(NEW)*:
One address believed to point at a Subject, carrying the evidence for that belief — a canonicalization rule, a redirect the reader's own browser traversed, or a Network's own submitted URL. A Subject's Aliases grow and are revised; its Subject URL is whichever one the rules currently elect.
_Avoid_: variant, duplicate, synonym, redirect

**Reading** *(NEW)*:
One reader's encounter with one Subject in one top-level frame — from when the address settles until it changes — carrying what caused it and which Network, if any, they arrived from.
_Avoid_: visit, session, pageview, tab

**Enquiry** *(NEW)*:
The work of finding out about one Subject: everything asked and learned, owned by the Subject rather than by any Reading. Several Readings share one Enquiry, and it outlives the Reading that started it.
_Avoid_: query, job, discovery run, request

### What we gather

**Network** *(UNCHANGED)*:
A social site whose conversations we read — Hacker News, Reddit, X.
_Avoid_: platform, source, provider, site

**Discussion** *(CHANGED)*:
One conversation on a Network — a Hacker News item, a Reddit post, an X thread — together with its replies, identified by that Network *and* its own identifier there. It belongs to no Subject.
_Avoid_: thread, post, comment section, conversation

**Mention** *(NEW)*:
The claim that a Discussion concerns a Subject, together with the evidence for it. The evidence decides the tier; the tier is never a property of the Discussion.
_Avoid_: hit, result, match, association, relevance

**Linked Mention** *(CHANGED)*:
A Mention evidenced by the Discussion's own submitted URL matching one of the Subject's Aliases, or by the reader having arrived here from that Discussion. The strong tier — this conversation is about this page — and the only tier that discharges the disclosure argument permitting an X Lookup.
_Avoid_: exact match, direct hit, tier 1

**Passing Mention** *(NEW)*:
A Mention evidenced only by the Subject's address appearing inside a Discussion's comments or body while that Discussion is about something else. Harvesting a comment page produces these on day one.
_Avoid_: inbound link, backlink, weak link, tier 1.5

**Topical Mention** *(CHANGED)*:
A Mention evidenced only by a keyword search on the Subject's title returning the Discussion. The weak tier: about the subject matter, never provably about this page.
_Avoid_: fuzzy match, related, tier 2, similar

**Observation** *(NEW)*:
One reading of a Discussion's mutable numbers — score, comment count, whether it still appears — stamped with the moment we received it, because no Network tells us when they were true. Observations are never corrected, only superseded.
_Avoid_: snapshot, metadata, stats, reading

**Movement** *(NEW)*:
What changed between two Observations of one Discussion: confirmed, corrected, withdrawn (it stopped appearing in an answer), or removed (the Network says so, and by whom). Omission from an answer licenses withdrawn and nothing stronger.
_Avoid_: diff, change, update, drift

### Asking, and not asking

**Lookup** *(CHANGED)*:
One live request to one Network asking one question about a Subject — which Discussions submitted this address, or which Discussions match this title. The two questions fail independently and are paced, counted, and cached separately.
_Avoid_: fetch, query, search, request

**Coverage** *(NEW)*:
Everywhere we turned for evidence about a Subject on this Enquiry, and what came back from each, so that an empty panel always means something specific. It accounts for every place at every moment; there is no place it can fail to mention.
_Avoid_: status, results, completeness, health

**Silence** *(NEW)*:
A Network answered about a Subject and had nothing. The only Lookup outcome that is evidence about the world rather than about us, and the only one it is ever safe to cache.
_Avoid_: empty, zero results, no hits, miss

**Refusal** *(NEW)*:
A Network could not answer, or we could not hear the answer — not signed in, rate-limited, forbidden, timed out, or the worker was killed mid-flight. A fact about the attempt, never about the Subject, and never cached.
_Avoid_: error, failure, exception, outage

**Withholding** *(NEW)*:
A Lookup we deliberately did not issue, inseparable from the reason the reader is owed for it — excluded, paused, kill-switched, compiled out, over budget, or no Linked Mention found yet. Restraint made visible, not a failure.
_Avoid_: skip, blocked, disabled, suppressed

**Garble** *(NEW)*:
A Network answered and the answer was not usable — unparseable, truncated, or an interstitial served as success. Never retried, never cached, and never mistaken for a Silence.
_Avoid_: parse error, bad response, malformed, corrupt

**Exclusion List** *(UNCHANGED)*:
The places we never issue a Lookup for automatically — private and non-web addresses, URLs carrying credentials, sensitive categories, and destinations where searching returns nothing useful. Enumerated, therefore incomplete by nature.
_Avoid_: blacklist, blocklist, denylist, filter

### What the reader's machine remembers

**Local Discussion Cache** *(CHANGED)*:
The reader's own store of Mentions and Observations, built only from Networks they were already on. It holds pointers and numbers, never content, and because it is filled by Harvest and never by Lookups it discloses nothing about what else they read.
_Avoid_: local index, history, store, db

**Harvest** *(CHANGED)*:
Recording, from a Network page the reader is already on, the Mentions its links imply — keyed on the address each link actually resolves to, never the tracking URL that was clicked.
_Avoid_: scrape, crawl, collect, index

**Lookup Record** *(NEW)*:
The record that we intended to ask a Network about a Subject and when, kept only so we do not ask again. It is a history of what the reader read, so it is written under opaque keys, kept briefly, and cleared separately from the Local Discussion Cache.
_Avoid_: cache, log, history, ledger

**Last Look** *(NEW)*:
The moment this reader was last *shown* a Subject's Discussions. Their own horizon, known only to their machine, and the only thing "what's new since you last looked" may be measured against.
_Avoid_: last visit, timestamp, seen at, watermark

### The Digest

**Brief** *(NEW)*:
The exact material a Digest is written from: the Discussions selected, the comments taken from them, and their Observations at that moment. It is supplied *to* a Digest and never claimed *by* one.
_Avoid_: corpus, context, input, sources

**Digest** *(CHANGED)*:
A set of Findings written from a Brief and accountable to it, marked complete or partial. Every claim in it traces to a Discussion in that Brief.
_Avoid_: summary, TL;DR, overview

**Finding** *(NEW)*:
One attributed statement in a Digest, always carrying at least one Citation. A Finding may report a claim on the Subject as contested — the only judgement a Digest makes, and always someone else's.
_Avoid_: point, claim, item, bullet, insight

**Citation** *(NEW)*:
A pointer from a Finding to the specific Discussion and comment evidencing it, resolvable inside that Digest's Brief and separately checkable as still live.
_Avoid_: reference, link, attribution, evidence

**Digest Origin** *(CHANGED — merges Shared Digest and Local Digest)*:
Where a Digest was written: **Shared**, by us for a Subject over the popularity threshold and served to every reader of that page, or **Local**, by the reader's own Provider and never leaving their machine. Not two kinds of Digest — one kind, two writers.
_Avoid_: cached digest, public digest, server digest, client digest, private digest

**Watermark** *(CHANGED)*:
The Observations in a Digest's Brief — what its Discussions looked like when it was written. It is that Digest's own horizon, never the reader's.
_Avoid_: timestamp, version, etag, last look

**Delta** *(CHANGED)*:
What has changed since a stated horizon: Movements in a Subject's Discussions, plus Findings that appeared, were withdrawn, or reversed. Against a Last Look it is "what's new since you last looked"; against a Watermark it is what a Digest would need rewriting for.
_Avoid_: diff, update, refresh

### AI and artifacts

**Provider** *(CHANGED)*:
A source of AI capability the reader has connected — their ChatGPT subscription, their own API key, or their browser's on-device model. Exactly one is active; no caller branches on which, and every Digest records which one wrote it.
_Avoid_: model, backend, LLM, integration

**Discussion Index** *(CHANGED)*:
A shipped, compact record of addresses known to have at least one Discussion. It can suspect and it can be silent; it can never say a Subject has none — so it may only make a Lookup faster, or make us distrust an unexpected Silence.
_Avoid_: bloom filter, cache, database, prefilter

**Spread** *(CHANGED)*:
Which communities a Subject travelled into, how often, and how reception differed — an observed pattern of travel, never a rating of its publisher, and meaningless apart from the Coverage it was observed over.
_Avoid_: bias, lean, reach, virality

---

## 3. What the stress tests broke

Twelve failures, each of which forced vocabulary. Marked **VERIFIED** where I executed it.

**The ADR 0006 citation invariant was decoration in three of four models. VERIFIED.** The cross-field filter closed over `writtenFrom`/`evidence` — *a field of the payload the model produced*. A Provider that fabricates a corpus entry and a citation naming it satisfies the check by hallucinating slightly more; `Digest.makeOption(fabricated)` returns `Some`. The product's highest-trust surface — a contested flag against a named medical paper — renders with a dead link and an invented quote. → **Brief**, supplied out of band. I verified a stronger form than any model proposed: the Brief as a *decoding service*, so `Schema.decodeUnknownEffect(Finding)` types as `Effect<Finding, SchemaError, Brief>` and TypeScript will not let you decode without providing it. Output: fabricated citation `REJECTED — cites Reddit:t3_9zzzzz, which is not in the Brief`; honest citation `ACCEPTED`; empty citations `REJECTED — Missing key`. Corollary rules: `writtenFrom` is encode-only, and model output is always **decoded**, never `.make`d.

**Cross-Network id collision defeated it anyway. VERIFIED.** `DiscussionId` as a branded string with `network` as a sibling field means every citation check, every reconciliation accumulator, and every Watermark keys on the id alone (`new Set<string>`, `Record<DiscussionId, Vitals>`). A Reddit permalink citing base-36 `1abc2de` against an HN corpus containing item `1abc2de` was **accepted**. → Discussion identity is the **pair**, with its own key derivation. Verified fixed: `Equal.equals(hn, rd) === false`, distinct hashes, `HashSet` size 2, and the same citation now `REJECTED — cites Reddit:41293011, which is not in the Brief`.

**Runtime equality collapsed the two tiers in the model judged strongest on keeping them apart. VERIFIED.** Three `Schema.Opaque` brands over *identical fields* win at compile time (`concat` is TS2769) and lose at runtime: `Equal.equals(linked, topical) === true`, same hash, `HashSet` size 1. Anything reaching for structural equality — `Stream.changes`, a `HashMap` key, `Cache` — silently keeps whichever arrived first. Tagged unions carrying *different evidence fields* give `false` and size 2. → tiers must differ structurally, and Discussion identity needs a declared `Equivalence` used by every set, fold, and cache key. Neither family gives you "have I seen this Discussion?" for free: two Linked Mentions of the same thread at different scores are unequal in both.

**`observedAt` as network time is unpopulatable. VERIFIED against the live API.** The sharpest finding in the panel, grafted by all three judges, rests on a field no Network supplies. HN Algolia returns `points: 1859`, `created_at: '2021-10-21'` (when the *thread* was posted), `updated_at: '2026-05-02'` (Algolia's reindex, 4.5 years later). There is no as-of time for `points`. → **Observation** is explicitly stamped with *our receive time*, reconciliation is receive-ordered, corrections below a noise floor are suppressed rather than rendered as news, and Observations are only ever compared within one Discussion (hence within one Network).

**Every model had one lifetime where it needs three. VERIFIED fix.** The Reading owned rendering, request issuance, and expensive irreversible work — with opposite correct behaviours on navigation. Back-button at 900ms discards an X request already spent against the reader's own account and an HN answer that is exactly what the Local Discussion Cache exists to hold; leaving a YouTube video discards ~1800 tokens of the reader's own ChatGPT subscription. → **Enquiry**, Subject-keyed and refcounted. `RcMap` gives it exactly: two concurrent surfaces (pill + panel) → `opens=1`; teardown only after the idle TTL; sequential re-entry within TTL reuses the warm entry without reopening. Digest generation is *banked* — it completes and lands in the store whether or not anyone is still watching.

**Keying by Subject leaks; keying by Reading duplicates.** Two tabs on one URL, one arrived from an HN item and one from a Slack DM: Subject-keyed models show tab B a Linked Mention whose stated evidence is "you arrived here from HN item 39285714", which is false, and it is the *strong* tier lying. Reading-keyed models issue two X Lookups 29 seconds apart, defeating ADR 0001's "cache hard". → the split: **Enquiry** holds Subject-keyed *knowledge*; **Reading** holds the reader's *stance* — the cause, the arrival, this reader's horizon, what this surface has been shown.

**A 200 that parses can still be a lie.** Algolia mid-reindex on its URL-restricted replica returns `{"hits":[],"nbHits":0}` for a page with two submissions; a Cloudflare interstitial arrives as `text/html` with a 200. Every model files the first as knowledge ("we asked and there was nothing"), closes the X gate on it as a *promise kept*, and caches it for the TTL. None has a constructor for the second, so it lands on a transport reason and is therefore retried. → **Garble** (non-retryable, uncacheable, never closes the gate) and **Silence** as a separate, cautious thing. And the free instrument nobody used: ADR 0005 forbids the Discussion Index from gating a Lookup, but nothing forbids it from *distrusting a zero*. An `Answered(0)` on a Subject the Index suspects is a suspect Silence — do not cache it, do not close the gate on it, ask again. Ticket 13 already establishes the Index as advisory-negative only, so this adds no gate.

**The X gate is tier-blind, and its settled/unsettled test uses the wrong quantifier. VERIFIED.** ADR 0001's warrant is precise: X is asked only after another Network returned a Discussion, "proving the page is already publicly discussed, so asking X discloses nothing new." A *title* match proves the subject matter was discussed; the address we send X is still novel, so the disclosure argument is void. All four models sum both tiers — the provenance lens defends this explicitly. Separately, the capability lens's `some(l => l.standing === "Answered")` reports "settled: this page is undiscussed" for the routine ADR 0013 case where HN answers 0 and Reddit 403s. → the predicate is **Linked-tier only**, stated in the tier definition itself, and the settled test is `every`-quantified over (Network × question) pairs.

**Nothing recorded intent, and MV3 kills the worker without running finalizers.** Every model writes the Lookup outcome; the respawned worker therefore has no record it asked X and asks again. A ten-tab session across ten worker lifetimes gets ten fresh X budgets. There is also no state for "we were asking and will never find out" — `NotAsked` re-runs everything including X, `Asking` never settles. → the **Lookup Record** is written *before* the request with a lease, and **Refusal** explicitly covers "we could not hear the answer."

**Absence has six causes and every model has one word.** Moderator removal, author deletion, subreddit going private, ban, a search that stopped returning a three-year-old match, and a Lookup that used a different Alias — all collapse to "vanished". Worse, the capability lens's `licensesWithdrawal` guard fires *backwards* on the private-subreddit case: Reddit answers successfully and omits the row, so the guard permits withdrawal of a Discussion that still exists. → **Movement** distinguishes withdrawn from removed, and omission from an answer licenses only the weaker.

**A Digest that loses its Provider mid-stream discards a complete, correctly-cited Finding and blames the reader's model.** ~1800 tokens arrive, one valid Finding plus a truncated second; `JSON.parse` throws at position 343 and the whole document is dropped as "unciteable". → the citation invariant lives on the **Finding**, not the Digest root, so partial output is salvageable and a Digest is marked complete or partial. This also removes the latent hole where `findings: []` decodes as a structurally perfect, fully "cited", empty Digest. With Community Notes now out of scope (map, 2026-08-08; ADR 0006 amended), the "every Finding cites" rule has no exception at all.

**Two smaller ones with real cost.** Findings have no identity, so a regenerated Digest with one Finding inserted at the front diffs to eight JSON Patch operations and the reader is told all four are new — Finding identity must derive from claim plus citations, not position. And the Exclusion List is modelled purely as a pre-Lookup gate: nothing says what happens to the Lookup Record entry for a hospital portal when we ship the rule tomorrow. The Lookup Record's opaque keys plus an origin-scoped clear are the cheap answer.

**One adversarial finding is superseded and should not be propagated.** The "truncated index shard" scenario assumes sharding and a schema-only integrity story. Ticket 13 resolved both: there are **no shards** (one 4.05 MB binary fuse filter), each blob is pinned by `sha256` in the manifest, a `canonicalizerVersion` mismatch makes the client ignore the filter entirely, and any corrupt or unparseable index falls back to last-known-good and then to no index. What survives is vocabulary only: "index stale" is the wrong word for "index absent", and they need different copy.

---

## 4. Proposed service decomposition

Every primitive below exists at the path given (verified). House style: `Context.Service<Self, Shape>()("parle/<path>/<Name>")`, hand-written `static readonly layer`, `Effect.fn("Name.method")` on service methods.

**`SubjectIdentity`** — `parle/domain/SubjectIdentity`
```ts
{ readonly rulesVersion: number
  readonly identify: (raw: string) => Effect<Option<SubjectUrl>>          // None = not a Subject
  readonly resolve:  (raw: string) => Effect<Resolution>                   // costs a request; total
  readonly aliasesOf: (s: SubjectUrl) => Effect<ReadonlyArray<Alias>>
  readonly merge: (a: Alias, b: Alias, evidence: AliasEvidence) => Effect<SubjectUrl> }
```
Hides the rules table, redirect following, and the mechanical half of the Exclusion List — and is the **only** minter of `SubjectUrl`, so every key in both tracks provably went through one rules version. `Option.none` rather than a failure means "not a Subject" is one answer for an excluded page, an unresolvable `t.co`, and an internal hostname. `merge` is new and is what makes syndication, post-publication canonical changes, and YouTube's eight aliases repairable rather than permanent silent misses. Exposing `rulesVersion` is what ticket 13's anti-divergence clause already requires.

**`ReadingWatch`** — `parle/reading/ReadingWatch`
```ts
{ readonly readings: Stream<ReadingBoundary, never, never> }
// Stream.fromEventListener over popstate/pushState + the tabs adapter; top frame only.
```
Hides SPA heuristics, debouncing of transient addresses, and the cause of each boundary. Top-frame-only is enforced here because a `youtube-nocookie.com/embed` iframe must not mint a Subject. Records the arriving Network (usually all a referrer gives) on the Reading, not on any Mention.

**`LookupPolicy`** — `parle/policy/LookupPolicy`
```ts
{ readonly permits: (ask: Ask, reading: Reading, coverage: Coverage) => Effect<Result<Permit, Withholding>>
  readonly wouldAutoLookUp: (s: SubjectUrl) => Effect<Result<Permit, Withholding>>
  readonly pauseSite: (s: SubjectUrl) => Effect<void> }
```
One seam for the Exclusion List, per-site pause, the kill switch, the build flag, the budget, and ADR 0001's gate. It returns a `Withholding` — never a boolean — so an omission always lands in Coverage with the reason the panel renders. Taking `coverage` makes the X gate a **data dependency**: you cannot ask about X without producing the evidence that a Linked Mention already exists. The gate itself is a total pure function in `packages/domain`, not a `Deferred`, so the wave-2-settled-empty deadlock is unexpressible. The kill switch is read *inside* the retry loop via `Schedule.while`, fed by `Resource.auto(fetchManifest, Schedule.spaced("30 minutes").pipe(Schedule.jittered))` so a failed refresh leaves last-known-good rather than opening the gate.

**`DiscussionSource`** — four keys, one shape: `parle/source/LocalRecall`, `/HackerNews`, `/Reddit`, `/X`
```ts
interface DiscussionSourceShape {
  readonly place: Place
  readonly linked:  (s: SubjectUrl, aliases: ReadonlyArray<Alias>) => Stream<Consultation, never, never>
  readonly topical: (s: SubjectUrl, title: string)                 => Stream<Consultation, never, never>
}
```
Four distinct keys is what makes the gate structurally enforceable — `X` is reachable only through a branch on a Linked Mention and is otherwise never in scope — and stops a Reddit fake standing in for an HN fake. `linked`/`topical` are separate methods because they are physically different requests with independent failure profiles, separate rate-limiter keys, and separate cache namespaces. `E = never` is part of the contract: each layer ends in `Stream.catchCause(c => Stream.succeed(classify(c)))` plus a *total* `HttpClientResponse.matchStatus` — 403 is deliberately outside `retryTransient`'s transient set, so ADR 0013's Reddit 403 and X's auth 403 fail fast into a rendered state instead of burning the reader's own quota. Per-Network policy is a client transformer applied once at layer build; `withRateLimiter` needs `times: 0` on X because its default 429 retry is **unlimited**. `linked` takes the alias set, not one string — otherwise every aliased site is a systematic strong-tier false negative.

**`Enquiry`** — `parle/enquiry/Enquiry`
```ts
{ readonly about: (s: SubjectUrl) => Effect<Stream<Coverage, never, never>, never, Scope> }
// RcMap.make({ lookup, idleTimeToLive }) keyed on SubjectUrl.
```
The only discovery capability any caller has, and the only place that knows there are waves. Two surfaces on one Subject share one set of Lookups; a reader who navigates away and back within the TTL joins the warm entry; teardown is refcounted, not tab-scoped. Emits whole `Coverage` snapshots so the panel folds nothing and any single frame is renderable — the tuning constant that silently truncates a late subscriber's event prefix has nowhere to bite. Waves 1–2 are `Stream.merge` (not `concat`, so a slow iOS IndexedDB read cannot block the network), reconciled by receive time.

**`Recollection`** — `parle/memory/Recollection` (the Local Discussion Cache)
```ts
{ readonly recall: (s: SubjectUrl) => Stream<Mention, never, never>
  readonly remember: (ms: ReadonlyArray<Mention>) => Effect<void>   // total; eager; storage failures swallowed
  readonly observe:  (os: ReadonlyArray<Observation>) => Effect<void>
  readonly forget: (what: "harvest" | "one-origin" | "all") => Effect<void> }
```
Stores **Mentions**, not rows, so a cache hit arrives already carrying its tier and its provenance and the panel interprets nothing. `remember` refuses a Mention without a `SubjectUrl`, which is how ADR 0012's "key on the destination" becomes unrepresentable-otherwise rather than remembered. Totality is load-bearing: MV3 kills fibers without running finalizers, so writes commit eagerly per event and a storage failure must not widen the pipeline's error channel. Sits on `KeyValueStore.make` over the Cache API (ticket 13: `storage.local` JSON-stringifies a `Uint8Array` and blows the quota), which also satisfies ADR 0003's no-direct-`chrome.*` rule.

**`LookupRecord`** — `parle/memory/LookupRecord`
```ts
{ readonly intend: (s: SubjectUrl, n: Network, q: Question) => Effect<Lease>   // BEFORE the request
  readonly settle: (l: Lease, outcome: Settled) => Effect<void>
  readonly asked:  (s: SubjectUrl, n: Network, q: Question) => Effect<Option<AskedAt>>
  readonly forget: (scope: "all" | { origin: string }) => Effect<void> }
```
Separate from `Recollection` because harvest-derived memory and lookup-derived memory have opposite privacy properties, and ADR 0012's single clear action cannot honestly cover both. `intend` before the request is the only way ADR 0001's "at most once per long TTL" survives a service worker dying mid-flight. Keys are opaque — this store never needs to *read* a URL back, only recognise one — which shrinks the entire residue class.

**`Harvester`** + **`LinkResolver`** — `parle/harvest/*`
```ts
Harvester:    { readonly offer: (page: NetworkPage) => Effect<void>
                readonly prioritise: (s: SubjectUrl) => Effect<void> }   // "the reader is standing on this"
LinkResolver: { readonly destinationOf: (raw: string) => Effect<Resolution, never, never> }
```
The daemon is owned by the layer, not any caller: `Layer.effect` holding a `PubSub`, consumer on `Effect.forkScoped`, `Stream.mapEffect(resolve, { concurrency: 4 })`, `Stream.throttle({ strategy: "shape" })`, `Stream.buffer({ strategy: "suspend" })`. Never sliding or dropping — a dropped Discussion is exactly the invisible false negative the map names. `prioritise` is the demand channel: a Reading can say "I may be the destination of a pending resolution", which is the fix for the reader's thumb beating a politeness-throttled FIFO to the page. A navigation the browser already performed is itself a resolution and back-fills the queue for free. Resolution is total — an unresolvable link is stored on the shortlink with an unresolved marker, never dropped.

**`Provider`** — `parle/ai/Provider`
```ts
{ readonly id: string; readonly model: string
  readonly chat: (turns: ReadonlyArray<Turn>) => Stream<Chunk, ProviderUnavailable> }
```
One method. v1 collapses it with `Stream.mkString`; v2 fact-check runs `Stream.runForEach` over the same layer — ADR 0008's obligation at zero cost. Codex SSE and BYOK SSE arrive via `HttpClientResponse.stream → decodeText → splitLines`; Chrome's on-device model via `Stream.fromAsyncIterable`. Deliberately **no structured-output method**: structured generation is a decode concern, and putting it here would make ADR 0006's guarantee depend on which Provider is connected, which ADR 0004 forbids. `id`/`model` exist so a Digest can be *stamped* — nothing branches on them. Three layers for one key, selected by `Layer.unwrap`, with `Layer.catchTag("OnDeviceUnavailable", …)` so a build failure substitutes a fallback instead of reaching the app's error channel. On-device availability is probed at build time; Codex token expiry must be call-time, or the layer becomes unbuildable mid-session.

**`Digests`** — `parle/digest/Digests`
```ts
{ readonly brief:  (s: SubjectUrl, linked: ReadonlyArray<LinkedMention>) => Effect<Brief, never, ...>
  readonly write:  (b: Brief) => Stream<Finding, DigestRefused, Provider | Brief>
  readonly admit:  (raw: unknown, b: Brief) => Effect<Digest, SchemaError>
  readonly since:  (s: SubjectUrl, h: Horizon) => Effect<Option<Delta>> }
```
The only construction site for a Digest, and `admit` is the single door for Provider output **and** Shared Digest bytes alike. That is not distrust of our own backend: the invariant is boundary code, the two tracks release independently, and ADR 0002 makes the origin user-configurable while ADR 0010 invites forks — so if the check lived only server-side there would eventually be two versions of it. The security property falls out: a hostile, buggy, or self-hosted origin cannot inject an uncited flag. `write` returns a `Stream<Finding>` because the invariant is per-Finding, which is what makes a truncated Provider stream salvageable and ADR 0008's streaming panel real rather than nominal. `since` takes the horizon as an argument, so one computation serves the reader's Last Look and the Digest's Watermark.

**`SharedDigests`** and **`DiscussionIndex`** — `parle/backend/*`
```ts
SharedDigests:   { readonly lookup: (s: SubjectUrl) => Effect<DigestAnswer> }   // Hit(raw, brief) | Miss | Unreachable
DiscussionIndex: { readonly hint: (s: SubjectUrl) => Effect<Possible | NotListed | NoIndex>
                   readonly state: Effect<IndexState> }
```
Two independent backend halves, two independent degradations, and neither in the client's requirement channel — both reached only via `Effect.serviceOption`, whose `R` is `never`. That is a compile-time proof of ADR 0011, not a convention. `SharedDigests` returns **raw bytes**, so the citation invariant is re-run locally. `DiscussionIndex` has no method returning a decision and no boolean; `NotListed` is a statement about the index, not the world. Promoting it to a gate later means adding a constructor, which breaks every match site — exactly the friction ADR 0005 wants.

**`Board`** — `parle/reading/Board`
```ts
{ readonly open: (r: Reading) => Effect<SubscriptionRef<Reading>, never, Scope>
  readonly shown: (r: Reading) => Effect<void> }   // advances Last Look
```
Where the pipeline becomes state, and the only place the two meet. Built on `SubscriptionRef` (stable), not `effect/unstable/reactivity` — ADR 0002 treats `unstable/*` as scheduled debt and ADR 0008 requires this state model to survive into v2. Surfaces read **state, never events**, which is what makes a panel opened three seconds late correct. Renders coalesce with `Stream.groupedWithin(20, "16 millis")`, never `debounce`. `shown` is deliberately not "opened" — it is the event that advances the reader's horizon.

---

## 5. Effect v4 cheat sheet

`effect@4.0.0-beta.105`, pinned exactly (not a range), `@effect/vitest` in lockstep. **Deep imports only** — `import * as Effect from "effect/Effect"` is 6.9 kB gzip vs 20.0 kB for the barrel; make it an ESLint `no-restricted-imports` rule on commit one.

### Stable — strict semver, safe for the shared contract

| Module | Primitives we use |
|---|---|
| `effect/Context` | `Service` (the only way to declare a service), `Reference` (default value, `Identifier = never`, so reading adds no requirement) |
| `effect/Layer` | `effect` (eliminates `Scope`), `succeed`, `sync`, `provide`, `provideMerge`, `unwrap`, `catchTag`, `mock`, `effectDiscard`, `fresh`, `mergeAll`, `orDie`, `makeMemoMapUnsafe`; types `Success` / `Error` / `Services` |
| `effect/Effect` | `gen`, `fn`, `serviceOption`, `provide`, `acquireRelease`, `scoped`, `forkChild` / `forkIn` / `forkScoped` / `forkDetach`, `retry`, `timeoutOption`, `result`, `catch`, `catchTag`, `orDie` |
| `effect/Stream` | `merge`, `concat`, `unwrap`, `callback`, `catchCause`, `onEnd`, `interruptWhen`, `mapAccum`, `share`, `buffer`, `throttle`, `groupedWithin`, `changes`, `mapEffect`, `runForEach`, `fromEventListener`, `fromAsyncIterable`, `decodeText`, `splitLines`, `mkString`, `toReadableStream` |
| `effect/Schema` | `Struct`, `TaggedUnion`, `Opaque`, `NonEmptyArray`, `brand`, `check`, `makeFilter`, `decodeTo`, `decodeUnknownEffect`, `Literals`, `optionalKey`, `Uint8ArrayFromBase64`, `toDifferJsonPatch`, `toEquivalence`, `toArbitrary`, `toJsonSchemaDocument`, `toStandardSchemaV1`, `RedactedFromValue` |
| `effect/SchemaGetter` · `effect/SchemaError` · `effect/SchemaIssue` | `transformOrFail`, `passthrough`; `SchemaError`; `makeFormatterDefault` |
| `effect/RcMap` · `effect/RcRef` | `make({ lookup, idleTimeToLive })`, `get` — the Enquiry lifetime |
| `effect/SubscriptionRef` | `make`, `changes`, `update` — panel state |
| `effect/Cache` · `effect/ScopedCache` | `makeWith` (TTL from the `Exit`, so failures get a short TTL), `getOption`, `set`, `refresh`, `invalidateWhen` |
| `effect/Schedule` | `exponential`, `jittered`, `spaced`, `upTo({ duration, times })`, `while` (effectful predicate — the kill switch), `min` (caps delay), `max` (caps attempts) |
| `effect/Resource` | `auto(acquire, schedule)` — manifest / kill switch, last-known-good on failure |
| `effect/Deferred` · `effect/Queue` · `effect/PubSub` · `effect/Semaphore` · `effect/PartitionedSemaphore` | daemon plumbing; per-key permits |
| `effect/Equal` · `effect/Hash` · `effect/Equivalence` | declared Discussion identity |
| `effect/Result` · `effect/Option` · `effect/Filter` · `effect/Brand` · `effect/Array` (`Arr.NonEmptyReadonlyArray`) | |
| `effect/ManagedRuntime` | `make(layer)` — the WXT background entrypoint |
| `effect/Cause` · `effect/Fiber` · `effect/Exit` | `Cause.Done`, `Cause.hasInterruptsOnly`; `Fiber.interrupt` |
| `effect/testing/TestClock` | `layer`, `adjust`, `setTime` — deterministic "since you last looked" |

### `effect/unstable/*` — accepted migration debt, behind our own interfaces

| Path | Used for | Containment |
|---|---|---|
| `unstable/http/HttpClient`, `FetchHttpClient`, `HttpClientResponse`, `HttpClientRequest` | connectors, redirect resolution, SSE | one internal module per concern (`@parle/net/client`, `@parle/net/limits`) |
| `unstable/persistence/KeyValueStore` | Recollection, Lookup Record, settings | our own layer over the Cache API; interface is 6 effects |
| `unstable/persistence/RateLimiter` | backend only | ~35 kB gzip (its errors drag in `SchemaAST`); client uses a hand-rolled bucket over `Ref` + `Clock` |
| `unstable/ai/LanguageModel`, `Chat` | **evaluate, do not adopt yet** | ~38 kB gzip; hand-roll `Provider`, adopt behind the same key if it wins |
| `unstable/reactivity/Atom`, `AsyncResult` | **do not build v1 on it** | fits beautifully; keep as a thin adapter over `SubscriptionRef` |
| `unstable/rpc` | background ↔ panel, if adopted | ~135 kB gzip **on each side** — a deliberate decision, not a discovery at store submission |

The shared surface (`packages/domain`, `packages/index-codec`) imports **only** stable root modules — `Schema`, `Effect`, `Context`, `Layer`, `Result`, `Equivalence`. That is what keeps the byte-for-byte contract free of beta churn even though HTTP, persistence, and AI are not.

### v3-isms that fail (most published material is v3)

`Effect.Service` · `Effect.fork` / `forkDaemon` · `Context.Tag` / `GenericTag` · `Layer.scoped` · `Either` · `Stream.async` · `Schema.filter` · `Schema.transform` · `Schema.Literal(a,b)` · `Schema.parseJson` · `Layer.Layer.Context` · `Config.literal(a,b)(name)` · `Cause.isInterruptedOnly` · `HttpClientResponse.json(res)` · `Schedule.union` / `intersect` / `recurUpTo` · `Mailbox` · `Chunk` on the Stream surface. Point contributors at `node_modules/effect/AGENTS.md` and `node_modules/effect/ai-docs/`, which ship in the package and explicitly say to prefer them over the web.

### Repo rules, all verified as real hazards

1. Ban `{ disableChecks: true }` — it bypasses the citation filter; always **decode** model output, never `.make` it.
2. Every domain nominal passes the second `Brand` parameter to `Schema.Opaque` — without it the type is structural and an object literal satisfies it.
3. CI test asserting every service `.key` string is unique — duplicates typecheck and the second silently overwrites the first.
4. Never `Stream.partition` for the tiers — the tuple is `[excluded, satisfying]`, failing branch first.
5. `strategy: "suspend"` on every buffer; `"shape"` on every throttle. Sliding/dropping delivered 2 of 8 items with no event and no log.
6. `Stream.mapAccum`'s `initial` is a thunk and the step returns `[state, ReadonlyArray<B>]`.
7. `no-restricted-imports` forcing deep imports; keep `toArbitrary` / `toJsonSchemaDocument` / `toDifferJsonPatch` out of the extension bundle (they pull FastCheck and JsonPatch).

---

## 6. Open questions for the human

**1. Does an explicit reader request open the X gate?**
Options: (a) the toolbar action performs every Lookup including X; (b) it overrides the Exclusion List but not the prior-Linked-Mention gate, with a second, separate "check X anyway" affordance; (c) it never reaches X. ADR 0005 requires the toolbar never say "not applicable"; ADR 0001 calls the gate "the primary volume control" and lists it among "the terms on which this decision is acceptable". The tension is that the gate's warrant is a *disclosure* argument, not a consent argument — "they asked for it" does not make the address any less novel to X, and it is the reader's own account that gets actioned.
**Recommend (b).** One line in the gate function either way, and it keeps a deliberate second act between a curious reader and an authenticated request.

**2. Which horizon does the reader-facing Delta use, and what event advances it?**
Options: the Digest's Watermark (one answer for everyone, cheap, shareable) or the reader's Last Look (correct, client-only, private). And it must advance on *something*: Reading-open burns the horizon on a background tab the reader never looked at; panel-open burns it on a reader who never scrolled; Reading-end never fires on a crashed tab. Today's glossary ties a reader-facing feature to a backend mechanism, so a first-time visitor is told "what's new since you last looked" about a page they have never opened.
**Recommend Last Look, advancing on "shown"** — the panel reporting that the reader was actually presented with the Discussions. It makes the feature work with no backend and no Provider, which is what ADR 0007 claims for it.

**3. Is a Silence cacheable, and derived from what?**
A 20-minute-old post that had nothing at 09:00 is on the HN front page by 09:38; a 2019 post with nothing at 09:00 will have nothing at 10:15. Caching Silences is what makes repeat visits free; it is also the cleanest route to the invisible false negative the map says this project keeps choosing against. Worse, a cached Silence re-derives a Withholding — the X gate reads it and closes deterministically, forever.
**Recommend: cache Silences with a TTL derived from the Subject's own age; never cache a Refusal or a Garble; never store a Withholding — recompute it on read from the current Coverage.** The last clause is the important one and costs nothing.

**4. May a stored Mention's key be revised when Aliases merge?**
Options: (a) Mentions are immutably keyed on the Subject URL they were stored under — simple, and a canonical-URL change silently orphans a 640-point thread forever; (b) Mentions are keyed on an alias set that can grow, so a later merge repairs old rows. (b) means "the key" is not a value but a claim the world can revise, which is a real complexity increase in the cache and the index-key contract.
**Recommend (b), with merges only on evidence we observed** — a redirect the reader's own browser traversed, a Network's own submitted URL, or our rules — and never on a page's self-declared `rel=canonical` alone. The alternative is a permanent, undetectable false-negative class on exactly the pages worth reading.

**5. What does the Lookup Record store, and what clears it?**
ADR 0012 says clearing "must be a visible, single action", written when there was one store. There are two, with opposite privacy properties: one is a map of public conversations built from pages the reader already loaded; the other is a dated record of URLs they visited, which ADR 0001's once-per-TTL rule makes mandatory. Options: one store and one button (breaks the privacy argument); two stores and two buttons (worse UX, arguably more honest); two stores, one default button, one finer control.
**Recommend the third, plus opaque keys** — the Lookup Record never needs to read a URL back, only recognise one, so a per-install salted hash satisfies ADR 0001 completely and is unreadable if the disk is read. Needs an ADR 0012 amendment either way.

**6. When Findings reverse across a Local → Shared crossover, does the reader see it?**
ADR 0007 asserts both that the reader "must notice nothing except that it got faster" and that Shared Digests are "inspectable, reproducible, and correctable by issue" as a stated feature. A page that goes viral can move from "commenters broadly agree the unwind is orderly" to a contested Finding within hours. Options: (a) origin never surfaces and the change is silent; (b) origin surfaces as provenance always; (c) origin never surfaces, but a Finding-level Delta does — "an earlier synthesis, from fewer discussions, said X".
**Recommend (c).** It keeps the crossover invisible as a *mechanism* while making the reversal visible as *content*, which is what the reader actually cares about, and it turns ticket 17's "what does the client do when both exist and disagree" from a precedence rule into a feature.
