# We build no "Log in with <Network>" flow; consent is delivered as disclosure instead

Parle offers no OAuth login for Hacker News, Reddit, X, or YouTube. The ambient path — the reader's own browser session, which they already have — remains how we reach Networks. What an explicit login was meant to buy, **informed consent instead of silent background access**, is delivered as a UI and disclosure change: each Network's ambient access is opt-in, described in plain language, and switched off in one click.

## Why: on every Network in scope, the reader's login authenticates the reader but bills *us*

| Network | Login exists? | Whose quota it spends | What it unlocks |
|---|---|---|---|
| **Hacker News** | **No.** No OAuth server, no client registration; `/oauth` returns 404. Only a username/password form. | N/A — `hn.algolia.com` is keyless and meters **the reader's own IP** (10,000/hr) | Writes and personalization. Nothing we read. |
| **Reddit** | Yes | **Our app's tier** — 100 QPM *per OAuth client id*, shared across every install | The same endpoints the ambient path already reaches |
| **X** | Yes, and the `url:` search operator does exactly what we need | **Our pre-purchased credits**, ~$0.005 per post returned | Real capability, at roughly **$75/month per active reader** |
| **YouTube** | Yes | **Our Google Cloud project** | `search.list` is capped at 100 units/day *for the entire extension* |

Three further facts close it:

- **We could not obtain a Reddit client id even if we wanted one.** Self-service registration closed in November 2025 behind the Responsible Builder Policy ("you must request access and get explicit approval"), and since July 2025 an account may create **one client id for life** — which also kills bring-your-own-credentials as an escape hatch.
- **A shared bucket saturates early and degrades diffusely.** 100 QPM is ~144,000 requests/day globally; at two independently-paced Lookups per Subject plus ordinary diurnal concentration, that is roughly **600–800 daily active users**. And a shared bucket has no user ordering — it drops requests randomly across the whole population, including the readers who logged in specifically to get better results.
- **Three shipping products in this category independently arrived at our design.** CrowdWise, newsit, and tolon all hit `old.reddit.com/search` and parse HTML, with no client id anywhere.

## The cost we are accepting, stated plainly

OAuth would genuinely be **better for the reader**. A `read`-scoped grant cannot vote, post, or DM; it is enumerable at `reddit.com/prefs/apps` and revocable without logging out; and it is attributable, so a Network sees "app X acting for reader Y" rather than "reader Y's browser". That last point is the real one: **with ambient access, if a Network's anti-abuse decides the traffic looks automated, the enforcement lands on the reader's account rather than on us.** We are paying a risk with someone else's money, and no amount of disclosure fully removes that.

We accept it because the alternative is unavailable, not because it is unimportant. Two things partly blunt it: on X the paths are orthogonal, so adding OAuth would not make the cookie path safer — it would add a second, billed path *alongside* it; and MV3 has no keychain, so a refresh token would live in plaintext in extension storage, a **worse** credential store than the browser's own cookie jar.

## Consequences

- The disclosure is now load-bearing rather than cosmetic, and it must appear in the UI, not only the store listing.
- Every Network stays behind an opt-in toggle with an off switch, and the product must be fully useful with all of them off — Hacker News alone works, keylessly, from anywhere.
- We hold no tokens, so the Chrome listing needs no "Authentication information" disclosure and Apple's guideline 4.8 does not trigger.
- **Good-citizenship is now our only lever on Hacker News**, whose ceiling is the *reader's* IP: descriptive User-Agent, per-URL caching, deduplication, and no re-query on SPA route changes. Getting a reader's IP blocked is the sharpest self-inflicted risk we have.
- If the mechanism is ever needed, it is documented rather than re-litigated: Chrome uses `chrome.identity.launchWebAuthFlow` with a `chromiumapp.org` redirect; Safari and iOS have **no `browser.identity` at all**, so it requires the container app plus `ASWebAuthenticationSession` with a custom-scheme callback. Apple has rejected the simpler new-tab pattern under Guideline 4.0.

## Triggers to revisit

Reddit publishing a per-user-token rate limit or an extension-shaped access tier; a published date for the `.json` shutdown (none exists today); or X granting Premium subscribers credit that flows through to third-party apps.
