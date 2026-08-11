# Research: ticket 13 — Artifact contract: index encoding, sizing, sharding

## Bottom line

**Feasible, and simpler than the ticket assumes.** Pin the contract now; both tracks can proceed.

Three of the ticket's own premises are wrong and should be struck from the design:

1. **There is no sharding.** The full HN index is **4.05 MB measured** — one static file, fetched once, leaking exactly zero bits about browsing. The "how is a shard addressed / how big is a shard" question has no answer because there are no shards.
2. **It is not a bloom filter and has no tunable false-positive rate.** It is a binary fuse filter with three legal settings (8/16/32-bit fingerprints). We take 8-bit: p ≈ 0.38%, ~9.03 bits/key.
3. **Deletion is a non-problem.** The filter is immutable by construction; we rebuild monthly from an authoritative snapshot and carry a cumulative delta between rebuilds. No generational filters, no tombstones.

The one thing that genuinely threatens the plan is **where 4 MB lives on iOS**, not how it is encoded. That needs a real device.

---

## 1. Measured basis (re-verified in this session, 2026-08-08)

I re-ran the filter benchmark independently against `@expo/binary-fuse-filter@1.0.0` (MIT, confirmed on [the registry](https://registry.npmjs.org/@expo/binary-fuse-filter); only version ever published; `engines: node>=24`), N = 3,583,620:

| Metric | Measured |
|---|---|
| Serialized size | **4,046,876 bytes** (9.034 bits/key ⇒ **≈1.129 bytes per key**) |
| False-positive rate | **0.3785%** over 200k absent probes |
| False negatives | **0** over 50k present probes |
| Build time | 2,291 ms |
| Serialize | 2 ms · **Deserialize 2 ms** |
| Query throughput | 1M lookups in 333 ms (~3.0M/s) |
| gzip -9 / brotli | 3,857,917 / 3,850,156 (4.7% / 4.9% — **serve identity**) |

Size quantizes in 16 KB steps (segmentLength 16384 × (segmentCount+2)), so small N changes are free.

**Fingerprint widths 9/10/12 throw `RangeError: offset is out of bounds` at serialize — confirmed.** Reframe it: the library's public type is `8 | 16 | 32`, so those widths were never supported; this is missing input validation, not a regression. Either way **p is not tunable** — 8-bit (0.39%) or 16-bit (0.0015%, 2× size). 8-bit is better than the 1% target anyway.

---

## 2. Encoding: the key derivation is the dangerous part, not the filter

**MEASURED, and the single most important finding for this ticket:** the library's public API is `createBinaryFuseFilter(keys: string[], bits)`. It hashes keys *itself*, with a **non-standard FNV-1a-64 over UTF-16 code units** (`charCodeAt`, with an extra mix of the high byte when `charCode > 255`), then a murmur64 finalizer. There is **no way to supply precomputed 64-bit keys**.

That means the wire format cannot be specified independently of this exact library build. I also measured a real collision family in that hash: `hashString("\u0100") === hashString("\u0000\u0001")` (both `[137529095, 3035328058]`). Harmless for URLs, but it proves the hash is not reimplementable from its name — which matters because ADR 0010 promises anyone can rebuild this.

**Decision:** vendor the library into the monorepo as `packages/binary-fuse` (63 KB unpacked, pure TS, MIT — AGPL-compatible), retaining `LICENSE-xor_singleheader`, and add one entry point that accepts precomputed `u64` keys. Then the contract can state a language-independent rule:

```
key64 = first 8 bytes of SHA-256(canonicalUrl, UTF-8) interpreted little-endian
canonicalUrl = @parle/canonical @ <canonicalizerVersion>   // ticket 06
```

Without that fork, the contract is "whatever `@expo/binary-fuse-filter@1.0.0` does", and a self-hoster in any other language cannot reproduce it.

**The anti-divergence clause (non-negotiable):** the manifest carries `canonicalizerVersion`. **If it does not exactly match the client's, the client ignores the filter entirely and behaves as if no index exists.** A canonicalizer mismatch produces silent false negatives — the one failure mode a membership filter is supposed to make impossible — so it must fail loudly. Back this with a golden vector file (`canonicalUrl → key64` hex, plus a small reference filter and its expected hits/misses) that both the CI builder and the extension test suite execute.

**Query-string policy (blocks sizing, ticket 06 owns it):** measured N is 3,583,620 (query dropped) / 3,768,666 (query kept) / 3,862,735 (raw). **Recommend keeping the query minus a tracking-param denylist** — dropping it collapses `youtube.com/watch?v=`, arXiv ids and many CMSes into single keys, which is a correctness bug, not a size saving. Cost: +185k keys ≈ **+209 KB → ~4.26 MB total.** Cheap.

---

## 3. Sharding: do not build it

**Computed against measured size.** Total entropy of "which indexed URL" is log2(3,583,620) = 21.8 bits. Fetching shard *N* leaks log2(numShards) bits *per page load*: 256 shards → 8 bits (37% of the entire secret) for a 15 KB saving; 4,096 shards → 12 bits (55%) for a 1 KB saving. The bandwidth win is worthless and the privacy cost is most of the secret. Ticket 13's worry was correct; it simply evaporates at this scale.

*Inferred (not measured):* the real risk is **session correlation** — an ordered sequence of shard ids across a browsing session is far more identifying than the per-request bound, and no padding scheme fixes it.

**Revisit only if N plausibly exceeds ~50M (~56 MB), and then split by domain-popularity/topic tier — never by hash prefix.** Tier membership leaks vastly less than a hash bucket. Given the measured Reddit 403 from datacenter IPs, there is currently *no evidence* any bulk Reddit corpus is obtainable, so treat the 50M scenario as contingency math.

---

## 4. The artifact set and manifest

Everything mutable lives in **one small manifest**; everything large is **content-addressed and immutable**.

```
https://<indexOrigin>/v1/manifest.json          Cache-Control: public, max-age=900, must-revalidate
https://<indexOrigin>/v1/blobs/<sha256>.bin     Cache-Control: public, max-age=31536000, immutable
```

```jsonc
{
  "schemaVersion": 1,
  "generation": "2026-08-01T00:00:00Z",
  "canonicalizerVersion": "1.3.0",
  "filters": {
    "hn": { "kind": "binary-fuse", "fingerprintBits": 8, "serializationVersion": 1,
            "keyCount": 3768666, "bytes": 4255232,
            "url": "/v1/blobs/<sha256>.bin", "sha256": "<hex>" }
  },
  "delta": { "kind": "u64-truncated-32", "baseGeneration": "2026-08-01T00:00:00Z",
             "keyCount": 15890, "url": "/v1/blobs/<sha256>.bin", "sha256": "<hex>" },
  "exclusionList": { "version": 42, "url": "...", "sha256": "..." },
  "policy": { "xLookupEnabled": true, "sharedDigestMinScore": 50 },
  "digests": { "baseUrl": "https://<indexOrigin>/v1/digests/" }
}
```

**Per-network filters, not one merged filter** (answers ticket 16's "does it record *which* network"). Adding Reddit later becomes an added key in `filters`, not a format change. Cost is that a URL on both networks is stored twice; at HN-only this is free. **v1 ships HN-only** — that must be normal, not an error.

**Inner format is already versioned (MEASURED, read from source):** 28-byte little-endian header — `version=1`, `fingerprintBits`, 2 reserved, `seedHigh`, `seedLow`, `size`, `segmentLength`, `segmentCount`, `arrayLength`, then raw fingerprints. Deserialization validates the version byte and rejects widths other than 8/16/32, and copies the fingerprint region into a fresh ArrayBuffer (so peak memory is transiently ~2× the blob).

---

## 5. Deltas

**MEASURED:** only ~2,270 new unique HN URLs per day.

- **One cumulative delta file**, replaced daily, containing every key added since `baseGeneration` — the client always fetches exactly one delta, never a chain. Sorted `u32` (truncated key64) little-endian, 4 B/entry: ~9 KB/day, ~280 KB by the end of a month. Truncation FP at 280k entries is 0.0065% — negligible next to the base filter's 0.38%.
- **Lookup:** `hit = base.contains(key) || delta.has(key32)`.
- **Recovery:** if `delta.baseGeneration !== client.baseGeneration`, refetch the base. That is the entire catch-up protocol.
- **Cadence:** monthly base rebuild, daily delta. Client bandwidth ≈ 4.3 MB/month + 9 KB/day. R2 egress is free, so the constraint is the *user's* bandwidth, not ours.

Deletions need no mechanism: dead/deleted stories (15–21% of the corpus, measured) are excluded at build time and absorbed by the rebuild.

---

## 6. Versioning, compatibility, self-hosting

- **Major version in the path** (`/v1/`). A breaking change is a new path; `/v1/` keeps serving for ≥90 days.
- **Forward skew:** client ignores unknown JSON fields. It refuses any `schemaVersion.major` it doesn't know, any `filter.kind`/`fingerprintBits`/`serializationVersion` it can't handle, and any `canonicalizerVersion` mismatch — and in every one of those cases **falls back to last-known-good, then to no index at all.**
- **The index is advisory-negative only.** Missing, stale, corrupt, unparseable, or absent index ⇒ *assume every URL may have a discussion* and do the network lookup. This clause is what makes the "works with no backend deployed" commitment true by construction.
- **Self-hosting:** `indexOrigin` setting (default in `host_permissions`; custom origins via `optional_host_permissions` with a runtime grant). Trust root is TLS plus the manifest's `sha256` pinning each blob. **No signature key in v1** — a baked-in verification key would break self-hosting outright. Optional user-supplied `indexPublicKey` later.
- **Security argument that keeps the trust bar low:** *no URL ever leaves the device to the index origin.* A hostile index can only suppress discovery or waste lookups; it cannot learn browsing. State this in the store listing (ticket 12).

---

## 7. Where the 4 MB lives — the real risk

**DOCUMENTED:** `chrome.storage.local` quota is 10,485,760 bytes, "*as measured by the JSON stringification of every value plus every key's length*" ([Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)). **INFERRED (high confidence):** a 4 MB `Uint8Array` JSON-stringifies to `{"0":123,"1":45,…}` — roughly 5–6× inflation — so it blows the quota *and* does not round-trip as a typed array. **`storage.local` is the wrong home for this artifact.** Use the **Cache API** (store the `Response` — bytes, no serialization), with IndexedDB as fallback (structured clone preserves `ArrayBuffer`).

**THREAT, unresolved:** Apple Developer Forums [thread 759554](https://developer.apple.com/forums/thread/759554) reports `browser.storage.local.set()` failing above **~3 MB on iOS 18 beta despite `unlimitedStorage`**; an Apple engineer replied "the behavior you're seeing is not intentional," and the thread shows no resolution as of Aug 2024. **Current 2026 status is UNKNOWN.** This is why the tiered fallback below exists.

**Contingency tiers (all measured N, all whole-index — tiers, not shards, so they leak nothing):**

| Tier | N | Size @1.129 B/key |
|---|---|---|
| All live HN URLs | 3,768,666 | ~4.26 MB |
| `score ≥ 2` | 2,654,147 | ~3.00 MB |
| `descendants ≥ 1` (has comments) | 1,264,450 | ~1.43 MB |
| `score ≥ 5` | 1,035,423 | ~1.17 MB |

If iOS cannot hold the full artifact, ship `descendants ≥ 1` there — arguably the better product filter anyway, since a story with zero comments has no discussion to show.

**Cost is the storage read, not the parse:** deserialize measured at **2 ms** once bytes are in memory. MV3 service-worker wakeup cost is therefore a 4 MB read from Cache API, untested on device.

---

## 8. Corrections to the input research (do not propagate the originals)

The adversarial verifier refuted several claims that were feeding this ticket. Corrected:

- **Algolia pagination boundary is `page × hitsPerPage ≤ 999`**, not ≤ 1000. Offset exactly 1000 already returns zero hits.
- **The `message` field is NOT an error marker.** It appears *alongside* valid hits when a page straddles the boundary (`hitsPerPage=600&page=1` → 400 real hits *with* message). A crawler keying on it silently drops up to 999 results. **The only reliable stop condition is `hits.length === 0`.**
- **Day-window truncation risk was overstated 5.3×:** 664 of 7,120 days exceed 1000 indexed stories (9.3%), max 1,466 — not 3,511/49.3%/2,782. The larger figures counted dead/deleted rows Algolia never indexed.
- **Busiest hour ever = 136 stories** (2014-05-31 14:00 UTC), and **zero** of 169,224 hours exceed 200 — not 378. Hourly windows are safe for `tags=story` with ~7.4× margin. **Not safe for `tags=comment`** (busiest hour 1,306; 105 hours exceed 1000).
- **Algolia DOES document a rate limit:** 10,000 req/hr per IP (~2.78 req/s), rendered client-side at [hn.algolia.com/api](https://hn.algolia.com/api) and only visible in the JS bundle. The "sustains ≥20 req/s" claim is false — that was an artifact of 20-second test windows sitting inside a ~500–1000-request burst bucket. Measured: 20 req/s failed at t+48.5s; 10 req/s failed at t+65.4s; 5 req/s survived 180s clean. **Therefore the "Algolia full rebuild in 2.3–4.7 hours" figure is wrong: 168,570 hourly requests at the documented 2.78 req/s is ~17 hours.** Pace CI at ≤2.78 req/s; the sanction the docs name is *blacklisting*.
- **The throttle 403 is a host-wide edge block**, not an API throttle — `hn.algolia.com/` itself also 403s. Body is bare non-JSON HTML; there is **no `server: Google Frontend` header on the 403** (only on 200s), so don't detect throttling that way. Recovery is load-dependent, not a fixed 60s.
- **The 26,818 epoch-timestamp items are not a blind spot** — Algolia returns `nbHits=0` for `created_at_i` in [0, 3600), so they need no special handling.

**Source plan:** `play.clickhouse.com/hackernews_history` for the monthly base (live, ~8s lag, exact max-id match with Firebase) and daily delta; **Algolia is the ~17-hour manual disaster-recovery path only**, not a CI dependency. Do not use the S3 dump (stale since 2024-05) or a Firebase crawl (51–88 h measured). BigQuery remains **UNKNOWN** — nobody has run a query against it.

---

## 9. Impact on our architectural commitments

| Commitment | Verdict |
|---|---|
| Works with **no backend deployed** | **CONFIRMS.** The advisory-negative rule makes index absence a normal, tested state. |
| Discussion Index built in CI, served as static files | **CONFIRMS.** 4.26 MB, 2.3 s build, R2 static objects, zero request-time compute. |
| Reddit blocked from datacenter IPs | **THREATENS index coverage.** CI cannot crawl a Reddit corpus, so v1 is HN-only. The `filters` map keeps that from being a breaking change later. Ticket 14 owns it. |
| Safari/iOS parity | **THREATENS.** 4.26 MB vs an Apple-acknowledged, unresolved ~3 MB `storage.local` regression. Mitigated by Cache API + the `descendants ≥ 1` tier, but unproven. |
| X gated on HN/Reddit returning a result | **Unaffected** (an index miss suppresses HN/Reddit lookups, hence X — consistent with ADR 0001). |
| AGPL-3.0 throughout | **PARTLY CONFIRMS.** The library is MIT (verified) and vendorable. **UNRESOLVED:** redistributing HN-derived data. We ship only irreversible 8-bit fingerprints of hashed canonical URLs — no titles, text, or comments — which is the most defensible possible form, but there is no YC statement on this and I am not qualified to give the opinion. |
| Ticket 13's own sharding bullet | **INVALIDATED.** Delete it. |
| Ticket 16's "bloom filters do not support deletion" premise | **INVALIDATED.** Wrong filter family, and deletion is designed away. |

**Honest unknowns I could not close:** the real-world false-positive *cost* (depends on the ratio of indexed to non-indexed pages an actual user visits — we have no browsing-distribution data); the legal status of redistributing derived HN data; whether `play.clickhouse.com` permits automated CI use (free demo, no SLA, `readonly=1`, `max_result_rows=1M`, 60 s timeout — the full export needs ≥4 paginated queries); and BigQuery's viability.

---

## 10. Next actions

1. **Land ticket 06 first.** `@parle/canonical` + golden vectors is a hard dependency of this contract. Decide the query-string policy explicitly (recommend: keep, minus tracking denylist).
2. **Vendor `packages/binary-fuse`** from `@expo/binary-fuse-filter@1.0.0` (MIT notices retained) and add a precomputed-`u64` entry point, so the contract is `SHA-256(canonicalUrl)[0..8] LE` rather than "whatever the library does."
3. **Write the manifest JSON Schema + fixtures**, including a fixture for every rejection path (unknown `schemaVersion`, unknown `filter.kind`, `canonicalizerVersion` mismatch, sha256 mismatch, truncated blob). Both tracks then build against fixtures and need no further coordination.
4. **Assert `hits.length === 0`** as the only Algolia stop condition, pace at ≤2.78 req/s, and treat non-JSON 403 as retryable — in the DR crawler, before anyone runs it.
5. **Requires a real device — blocking iOS ship:** on iOS 18/26 Safari Web Extension, write ~4.3 MB into Cache API and IndexedDB, measure cold-read latency, confirm whether `unlimitedStorage` is required, and determine whether the ~3 MB `storage.local` regression persists. Feeds ticket 08.
6. **Requires a real MV3 profile:** measure Chrome service-worker cold-wakeup read latency for a 4.3 MB Cache API entry across ~30s idle terminations. Deserialize is 2 ms; the read is the unknown.
7. **Requires a residential IP:** nothing for the index itself (it never talks to HN at query time) — but ticket 14's Reddit corpus does.
8. **Open a legal question** on HN-derived hash redistribution under AGPL-3.0, and check ClickHouse playground terms before wiring it into CI.
