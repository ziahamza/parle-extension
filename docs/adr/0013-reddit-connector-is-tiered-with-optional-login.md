# The Reddit connector is tiered, and a Reddit login is offered but never required

Reddit access is built as an ordered fallback chain in the extension, with an optional account connection for users who want durable, richer results:

1. **`www.reddit.com/api/info.json?url=…` with `credentials: 'include'`** — exact-URL semantics, ~25 results, structured. Requires reddit.com cookies but **not a logged-in account**; an anonymous cookie jar suffices.
2. **`old.reddit.com/search?sort=top&q=url:…`** (HTML, cookie-free) — ~11 results, parsed from `.search-result-link`. Covers users with no Reddit cookies, users blocking third-party cookies, and Safari's credentials bug.
3. **Silent degradation** — no user-visible error, and every other Network keeps working.

**Amended 2026-08-08: there is no "Connect Reddit" login.** This ADR originally offered OAuth as an optional upgrade, on the assumption that an authenticated connector would be more durable. Research inverted that assumption — see [ADR 0014](./0014-no-network-oauth.md). Reddit's own Data API wiki states: *"Traffic not using OAuth **or login credentials** will be blocked, and the default rate limit will not apply."* A logged-in browser session is named as a **separate accepted form of identification**, not metered against any client id. Adopting OAuth would therefore move us *off* an unmetered per-user path *onto* a metered shared one of 100 QPM per client id — across every install.

What the login was reaching for — informed consent rather than silent background access — is delivered instead as **a UI and disclosure change**: the Reddit path is explicitly opt-in, with plain-language wording that it uses the reader's existing Reddit session, and a prominent off switch. That costs nothing and needs no registration.

## Why tiered rather than one path

Measured 2026-08-08 by an omit-vs-include A/B in one browser, one origin, one second: `.json` returns **403 with `credentials: 'omit'` even from a good consumer IP**, and **200 with `credentials: 'include'`**. Meanwhile `old.reddit.com/search` returns **200 cookie-free** from a consumer IP. The two paths fail under *different* conditions, so the fallback is not belt-and-braces — it is the single mitigation covering three distinct failure modes at once.

The tiering is also a hedge against an announced change. Reddit's r/modnews post `1tq9vxo` (2026-05-28) states verbatim: *"we'll also be shutting down unauthenticated .json endpoints… Logged-in and authenticated access won't be impacted."* The same post names **RSS as the next surface under review**. Tier 1 is therefore on a published kill list, and tier 2 may follow.

## Why login is offered but never required

Reddit's own statement makes an authenticated connector the durable answer, and users who connect one get better coverage for longer. But [ADR 0004](./0004-ai-is-an-upgrade-not-a-dependency.md) makes discovery free and loginless — that promise covers the **core loop**, not merely the Digest, and it is what makes the extension installable without a decision. A required Reddit login would move the login wall from the optional AI layer to the thing the product is for.

## Consequences

- **CORS makes this extension-only.** Reddit sends no `Access-Control-Allow-Origin`; a cross-origin fetch from a page context fails. Both tiers require `host_permissions` and the extension background context. A content-script-only implementation is impossible.
- **Rate budget is shared with the user's own browsing.** Measured with cookies: `x-ratelimit-used: 6 / remaining: 94 / reset: 190`. Read `x-ratelimit-remaining` off every response and back off. One request per page view, hard-cached.
- **Safari is at risk.** FB15307169 (filed Sep 2024, reported still open) has Safari extension `fetch()` dropping credentials despite `credentials: 'include'` and host permissions. If unfixed, tier 1 is dead on Apple platforms and tier 2 carries iOS alone. Needs real hardware — ticket 08.
- **Do not use RSS on the request path.** Roughly one request per minute per IP, and publicly flagged as the next surface to close.
- **Reddit OAuth is not a fallback.** Self-service registration is closed behind the Responsible Builder Policy, and the free tier is 100 QPM *per client_id* — one budget shared across every user of an open-source extension. Removed from the design.
- **Ship no cached Reddit content.** `robots.txt` is `Disallow: /` and the Data API Terms restrict retention and redistribution. Any index we publish holds **URLs only** — never titles, scores, or comment text.
- Reddit coverage is **best-effort**, in acknowledged tension with `robots.txt` and Rule 8, and this must be stated plainly rather than implied.
