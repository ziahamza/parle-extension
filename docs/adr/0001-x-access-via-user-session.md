# X Discussions come from the user's own logged-in session, automatically, on every platform

X publishes no free URL-search API, so the only way to answer "who on X linked this page" is to issue requests against X's private web endpoints using the credentials already in the user's browser. We do this **automatically on page load, on by default, on every platform including iOS** — X coverage is core to the product, not an advanced extra — and we buy safety through aggressive caching, strict pacing, and plain disclosure rather than through opt-in or user-initiation.

## Considered Options

- **Opt-in toggle, off by default** — rejected: leaves most users with no X coverage.
- **User-initiated ("Check X" button)** — rejected: costs the auto-populated count that makes the product feel alive.
- **Auto on desktop, user-initiated on iOS** — rejected: two behaviours to explain, test, and support, and the iOS build would be the least dogfooded.
- **X API v2 Basic (~$200/mo) via our backend** — rejected: mandatory backend and a permanent cost floor.
- **Zero-risk X only** (on-page reading + the public Community Notes dump) — rejected: gives no answer to "who linked this page".

## Required mitigations

These are not optional polish; they are the terms on which this decision is acceptable.

- **Read-only, always.** The extension never posts, likes, follows, or mutates anything on X. No write endpoint is ever called.
- **An explicit reader request performs every Lookup, including X.** Opening the extension on a page overrides both the Exclusion List and the runtime gate below. The tension is recorded honestly: the gate's warrant is a **disclosure** argument, not a consent one — "the reader asked" does not make the address any less novel to X, and it is the reader's own account that bears any consequence. The judgement is that a reader who deliberately opens the panel on a page has asked a direct question and should get a direct answer, and that [ADR 0005](./0005-offline-prefilter-before-any-network-lookup.md)'s "the toolbar never says *not applicable*" outweighs the marginal disclosure. Automatic Lookups remain gated.
- **Runtime gate: X is asked only after another Network answered.** This governs **automatic** Lookups. Hacker News and Reddit are looked up on every non-excluded page; X is looked up only when one of them returned a Discussion — proving the page is already publicly discussed, so asking X discloses nothing new. This removes well over 95% of X requests without any index existing, and without the reader having to click anything. It is the primary volume control, and it means X results arrive a beat after the others, so Discussions must render progressively.
- **Cache hard.** A Subject URL is searched on X at most once per long TTL; repeat visits and back-navigation are served from cache. Caching is the second lever that keeps request volume sane.
- **Pace strictly.** Global request budget per unit time, well under anything that reads as automated traffic, with backoff on any 429/403. X gets stricter limits than any other Network.
- **Kill switch.** A remotely-updatable flag in the static artifacts can disable X access without shipping a new build, for when X changes its defences.
- **Degrade, never error.** When X is unavailable the panel shows "X unavailable" and every other Network keeps working.
- **Disclose plainly** — first-run screen, store listing, README, and Apple privacy manifest — that the extension queries X using the user's own session, and what that can mean for their account.

## Consequences

- Requests ride the user's session cookies. If X rate-limits or actions abusive traffic, **it is the user's own account that is affected**. The disclosure above is what makes that a consented risk rather than a hidden one.
- The endpoints are undocumented and change without notice; X coverage will break periodically. See "degrade, never error".
- Apple App Review and the Chrome Web Store may still reject broad `x.com` host permissions used this way. A build flag that compiles X session search out entirely is **required**, so a rejected store can still receive a shippable binary rather than blocking the whole release.
