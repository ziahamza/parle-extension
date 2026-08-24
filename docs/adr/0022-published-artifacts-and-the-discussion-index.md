# Published artifacts: the exclusion feed now, the Discussion Index next

ADR 0005 parked the Discussion Index as "a backend-track optimisation, not an MVP prerequisite",
and ADR 0011 fixed its role — an accelerator the extension is whole without. The MVP track has
shipped (3.1.4, published). This ADR un-parks the backend track, fixes the artifact contract, and
ships its first stage.

The through-line for every artifact below is one property: **download-only**. Today the core
mechanism *uploads* — every non-excluded page produces requests carrying that page's address to
third-party Networks. A published artifact inverts the direction: the client downloads a file
that is byte-identical for every install, and asks it locally. The host learns nothing about any
reader beyond "an install fetched today's file", which is the strongest privacy statement this
product will ever be able to make, and the reason the backend track exists at all.

## The artifacts, in the order they ship

1. **The exclusion feed** (`artifacts/exclusions.json`, this release). The bundled skip list's
   known failure is staleness by enumeration: an AI-chat service nobody listed waits for a store
   release. The feed makes it a data push. The client machinery predates this ADR —
   `Seed.withUpdate` folds an update **additively and version-gated**, so the artifact host can
   only ever *narrow* what is looked up, never widen it; a compromised, stale or absent host is
   harmless by construction, which is why the fetch authenticates nothing. `ExclusionFeed
   .readArtifact` treats the body as untrusted text, and drops entries in categories the
   installed build has no words for while keeping the rest, so old installs benefit from new
   files. Fetched at most daily, never before the first-run answer, applied at the next worker
   start.

2. **The filter** (next). A compact approximate-membership filter (bloom or xor) over every
   canonical URL Hacker News and Reddit have ever linked to. A miss is certain — such a page has
   no Discussions — so a miss can end the Lookup before any request exists. Most pages people
   read miss. This is the piece that changes what "look pages up automatically" *means*, from
   "send every page's address" to "ask only when the public record says there is something to
   find" — and it is therefore the gate ADR 0005 refused to build on a partial list: a filter
   built from the Networks' own record IS exhaustive over what it indexes, with the false-positive
   rate as the only leak, and that rate is a build parameter. Promotion of the filter from
   optimisation to gate stays an explicit decision with a measured bar, as 0005 required.

3. **The index shards** (after). URL-hash-prefix shards mapping canonical URL → Discussion
   pointers (network, id, score bucket, age bucket). A hit paints the panel without any Lookup;
   comment bodies stay live-fetched from the reader's own browser (ADR 0011's measured access
   asymmetry: the browser passes both Reddit gates, our infrastructure passes neither, so the
   index will be Hacker News-rich and Reddit-thin — accepted). Fetching a shard reveals a hash
   *prefix*, a deliberate few bits; the size of the leak is a build parameter and is stated in
   the privacy policy when this ships, not before.

Front-door judgement (ADR 0017/0019) and removed-thread hygiene move to index build time with
stage 3: judged once, centrally, from public data — instead of approximated in every install.
That is also where the residual noise class (a fresh junk submission of a mega-root inside the
30-day exemption) gets its durable fix.

## Hosting

Stage 1 is served from this repository — `raw.githubusercontent.com`, path fixed in
`ExclusionUpdates.FEED_URL`. Versioned by git, reviewable by anyone, deployable by merge, no new
infrastructure, and safe to serve from an untrusted CDN because the client enforces additivity.
Stages 2–3 are static files too and will outgrow raw-file serving (shard fan-out, cache
headers); they go to the Cloudflare account ADR 0002 already names, and the feed URL moves with
them in an ordinary release. The contract is the JSON/binary formats, not the host.

## What this must never become

- **No reader data flows up.** Artifacts are built from the Networks' public records only.
  Clients are never proxies for our crawling (ADR 0011), and no request a client makes carries
  anything about the reader to us — there is still no "us" at runtime, only static files.
- **No removal by feed.** An entry leaves the exclusion list only in a store-reviewed release.
- **No urgency channel.** The feed is daily-at-most by design; nothing in it may ever need to be
  faster, because a channel that must be fast becomes a channel someone will demand control of.

## Consequences

- The privacy policy names the feed endpoint and its cadence (§1 gains the entry in the same
  release that ships the fetch), and keeps naming every later artifact before it ships.
- `withUpdate`'s additivity and the codec's refusals are load-bearing disclosures and stay
  under test.
- The index builder is a batch job with its own repository-visible output; its thresholds
  (front-door fold, junk floor) become reviewable numbers rather than in-extension heuristics.
- Default-on lookups (chosen, parked) are re-sequenced to land *with or after* stage 2, because
  the filter is what makes the default defensible.
