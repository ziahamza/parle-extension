# Research: what an explicit Network login actually buys

# "Log in with X / Reddit / Hacker News" — decision

**Verdict: build none of them. Not because logins are dishonest — you're right that they're more honest — but because on every network in scope, the user's login authenticates the user while the quota bill lands on *us*. That is the opposite of what you're expecting it to buy.**

## The table

| Network | Does a login exist? | Whose quota does the login spend? | What the login actually unlocks | Worth building? |
|---|---|---|---|---|
| **Hacker News** | **No.** No OAuth server, no client registration, no developer portal. `news.ycombinator.com/oauth` → 404 "Unknown." Only a username/password form POST. | N/A — there is no app tier. `hn.algolia.com` meters **the user's own IP** (10,000 req/hr), and there is no key to register. | Writes (vote/comment/submit) and personalization. One real read gap: `showdead`. Nothing else. | **No.** Nothing to log into. |
| **Reddit** | Yes — OAuth2 `authorization_code`. | **Our app's tier.** "100 queries per minute (QPM) **per OAuth client id**" ([Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)). A user brings **zero** entitlement. | `oauth.reddit.com` `/api/info?url=` and `/search` — identical results to today. A *userless* `installed_client` token reaches the same endpoints. | **No.** And we can't get a client_id anyway. |
| **X / Twitter** | Yes — OAuth 2.0 + PKCE, public client. | **Our app's pre-purchased credit balance.** "Rate limits and billing are separate." ([rate-limits](https://docs.x.com/x-api/fundamentals/rate-limits)) | Genuinely real: recent-search with the `url:` operator, "Tokenized match on URL (matches url or expanded_url fields)" ([recent-search](https://docs.x.com/x-api/posts/recent-search)). | **No.** ~$0.005 per post returned, charged to us. |
| **YouTube** *(not in scope; priced for later)* | Yes — Google OAuth. | **Our Google Cloud project.** OAuth and API-key requests draw the identical bucket. | Only `forMine` (the user's own uploads). Zero product value. | **No** — and shipping the key is a verbatim policy breach. |

## Blunt one-liners

- **Hacker News: there is nothing to log in with, and nothing it would unlock.** Algolia is keyless, CORS-open (verified: `Origin: https://example.org` echoed back, HTTP 200 from a datacenter IP), and charges the user's own IP. Building "Log in with HN" would mean Parle collecting users' raw HN passwords — the exact opposite of the honesty argument. The one public attempt (hn.simplerauth.com, [HN 44395925](https://news.ycombinator.com/item?id=44395925)) did that and was killed by IP blocking and CAPTCHA.
- **X: the login works, the search works, the `url:` operator does exactly what Parle needs — and every result is billed to us.** "The X API uses pay-per-usage pricing. No subscriptions—pay only for what you use" ([pricing](https://docs.x.com/x-api/getting-started/pricing)). Posts read at $0.005 each. One moderately active user (50 lookups/day × 10 posts) costs us **~$75/month**. The pay-per-use ceiling is 2M post reads/month = $10,000/month, which at 10 posts/lookup buys the *entire user base* ~200,000 lookups/month — about 6 lookups/day if we had 1,000 users. There is no free tier for new developers as of 2026-02-06. Your instinct is right in principle here and simply unavailable in practice.
- **Reddit: the login is the only one that would buy us something real (durability against the .json shutdown), and it is the one we cannot obtain.** Self-service registration closed in Nov 2025: "Approval is required: You must request access and get explicit approval before accessing any Reddit data through our API" ([Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy)). The documented default is Devvit — "Developers should use the Developer Platform ('Devvit') to build apps on Reddit" — which runs *inside* Reddit and cannot back a cross-site browser extension.

## The Reddit arithmetic, stated honestly

100 QPM × 1440 min = **144,000 requests/day globally, across every install.**

| Assumption | Saturation point |
|---|---|
| 1 Reddit request per page-view, flat 24h load | ~4,800 DAU |
| Parle's actual design (2 independently-paced lookups per Subject) | ~2,400 DAU |
| Plus 3–4× diurnal concentration in US/EU daytime | **~600–800 DAU** |

Two corrections to how this gets argued, because overstated evidence gets re-quoted as measurement:

1. **The 10-minute window helps us, it does not hurt us.** Reddit's own wording: "QPM limits will be an average over a time window (currently 10 minutes) **to support bursting requests**." That is a documented concession, strictly more permissive than a hard per-minute cap. The real erosion is hour-scale diurnal concentration, which is unrelated to the window.
2. **A shared bucket has no user ordering.** It drops requests diffusely across the whole population. Degradation is random and universal, not a cliff after user N — including for the users who logged in *specifically* to get better results.

**And the point that reframes the whole thing: 100 QPM is the *price of adopting OAuth*, not a ceiling we're under today.** The same wiki says "Traffic not using OAuth **or login credentials** will be blocked, and the default rate limit will not apply." Login credentials — a logged-in browser session — is named as a *separate accepted form of identification*, not metered against any client_id bucket. Adopting OAuth would move us from an unmetered per-user path onto a metered shared one. Reddit reserves the right to cap us by population either way: it may limit "the number of API requests that you may make **or the number of App Users you may serve**" ([Data API Terms §2.9](https://redditinc.com/policies/data-api-terms)).

The BYO-client_id escape hatch is also closed: users face the same approval gate, and since 2025-07 each account may create **one** client_id for life (r/redditdev `1loeto4`: "an account can create up to 3 tokens, and this change will limit that to 1 token per account"). Asking a browse-and-forget extension user to burn their single lifetime allowance and survive an approval queue converts at approximately zero.

## Is an explicit login actually safer for the user? Yes — but we can't buy it, and it isn't free

These two answers genuinely differ, so take them separately.

**For the user, OAuth is better, and this is the strongest argument in your favor.** A `read`-scoped grant cannot vote, post, or DM. It is enumerable at `reddit.com/prefs/apps`, revocable without logging out, and *attributable* — Reddit sees "app X acting for user Y," not "user Y's browser." With ambient cookies, if Reddit's anti-abuse decides the traffic pattern is automation, **the enforcement lands on the user's account, not on ours.** That is a real ethical cost we are currently paying with someone else's money, and you're right to name it.

Three things blunt that win, though:

- **It only counts if OAuth *replaces* the ambient path.** For X the two paths are fully orthogonal — OAuth tokens go to `api.x.com` (billed, official), cookies go to `x.com` (free, unofficial). Adding OAuth doesn't make the cookie path safer or more legitimate; it adds a second, expensive path *alongside* it. For Reddit, replacement is only possible if we can register (we can't) and absorb the shared quota (we can't at scale). So the safety win isn't merely expensive — it's unpurchasable.
- **We'd be handing the user a worse credential store.** MV3 has no keychain. A refresh token lives in `chrome.storage.local` — plaintext on disk, and readable by content scripts unless we call `setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})`. Ambient cookies at least sit in the browser's own jar. (Apple is the exception: the container app can put the refresh token in the real iOS Keychain behind an App Group.)
- **Reddit PKCE support is undocumented — I could not establish it.** Without PKCE, a public client_id plus an auth code transiting a normal tab's URL is readable by any other extension holding host permission on the callback domain. That is a new attack surface ambient cookies do not have.

**For us, ambient is better, and it isn't close.** Login converts a diffuse, per-user, unattributable risk into a single concentrated chokepoint: a shared 100 QPM ceiling, a public client_id in an AGPL repo that Reddit's terms do not carve out, Reddit App Review "at Reddit's sole discretion," plaintext refresh tokens, Apple 4.0 rejection risk, and an "Authentication information" disclosure on the Chrome listing we don't need today ("Extensions are required to disclose how they handle user data, **even when data is processed or stored locally**" — [Chrome user data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)).

**So: your ethics are right and your economics are wrong, and the two are separable.** The thing you actually want — informed consent instead of silent background access — is a *UI and disclosure* change, not an OAuth integration. That version costs nothing and ships this week. OAuth doesn't buy the honesty; it buys an invoice.

Worth noting: **no shipping product in this category uses OAuth.** [CrowdWise](https://github.com/frizensami/crowdwise) hits `old.reddit.com/search` and cheerio-parses HTML with no client_id anywhere in the tree; [newsit](https://github.com/benwinding/newsit) and [tolon](https://github.com/rwanyoike/tolon) are the same pattern. That is Parle's current design, independently arrived at three times.

## If we ever do need OAuth: the mechanism that works on both platforms

Documenting this so it isn't re-litigated. `browser.identity` / `launchWebAuthFlow` is `version_added: false` on **both** `safari` and `safari_ios` in MDN browser-compat-data v8.0.10; Apple's guidance is `identity` — "Not supported. Initiate an OAuth flow in a new tab" ([Apple compat page](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)).

**Chrome:** `chrome.identity.launchWebAuthFlow` with `redirect_uri = https://<extension-id>.chromiumapp.org/`. No domain to own — the URL never resolves and the browser intercepts it. Register that exact URI with the provider. Do the token exchange and all API calls **from the background service worker under `host_permissions`**: `api.x.com` sends *zero* `Access-Control-*` headers and 405s the CORS preflight (measured 2026-08-08), so a content-script fetch simply fails.

**Safari/iOS — two options, neither requiring a domain we own:**

- **(A) Container-app flow (review-safe, more work).** Every Safari Web Extension ships inside a native app. Declare `CFBundleURLTypes` and run `ASWebAuthenticationSession` with a **custom-scheme callback** — its original and still-supported mode; https callbacks are the newer iOS 17.4+ addition. Refresh token → iOS Keychain behind an App Group; extension pulls short-lived access tokens via `browser.runtime.sendNativeMessage`. Providers accept this: Reddit's own [oauth2-ios-example](https://github.com/reddit-archive/reddit/wiki/oauth2-ios-example) registers `myappscheme://response`, and Apollo shipped `apollo://reddit-oauth`. Reddit's constraint is *exact match*, not https. **UX cost:** the containing iOS app cannot push messages into extension JS, so the flow is "leave Safari → open Parle → authorize → return," with the extension pulling the token on next activation.
- **(B) New-tab flow (simpler, reviewer roulette).** Open the authorize URL in a normal tab per Apple's own guidance, catch the callback with `tabs.onUpdated` (host permission) or an observational `webRequest` listener (available on iOS Safari 18+). **Safari's `webRequest` is observation-only on every platform** — `BlockingResponse` and `webRequestBlocking` are `version_added: false` for both `safari` and `safari_ios` — so it can read the callback URL but not intercept or redirect it. And Apple has rejected exactly this pattern: "Guideline 4.0 - Design The user is taken to a new Safari window or tab to sign in or register for an account, which provides a poor user experience" ([forum 768435](https://developer.apple.com/forums/thread/768435)), with reviewers demanding `ASWebAuthenticationSession`.

What does **not** work: `safari-web-extension://` as a redirect target (per-install UUID, and WebKit blocks non-HTTP(S) redirect schemes). What is **not** required: a hosted https callback page. An https static file is a fallback, not a necessity — and even then it's one static byte-stream, not a backend.

If we ever did register with Reddit, note the relevant grant is probably `installed_client` (application-only, `device_id`, **no redirect at all**) — because a user login unlocks nothing a userless token doesn't.

**Apple guideline obligations if any social login ever ships:** 4.8 (Sign in with Apple parity) does **not** trigger — Parle has no primary account. 5.1.1(v) does: Parle must remain fully functional logged-out, must offer an in-UI disconnect that actually revokes at the provider, and **may not store tokens off-device** — which forecloses the tempting "proxy through our server to hide the client_id" fix.

## Recommended build order

1. **Ship v1 with Hacker News as the guaranteed-quality connector.** Keyless, CORS-open, per-user-IP quota, works from anywhere. It is the model the other connectors should aspire to, not a gap to fill with a login. Be a good citizen against the 10,000/hr per-IP ceiling: descriptive User-Agent, per-URL cache, dedupe, no re-query on SPA route changes. Getting a user's IP blacklisted is the only real HN risk we have.
2. **Keep the Reddit ambient-cookie path, and make it explicitly opt-in.** A clear toggle, plain-language disclosure of "uses your existing Reddit session," a prominent off switch, one request per page-view, aggressive caching. **This is the deliverable that satisfies your actual goal** — informed consent instead of silent background access — at zero cost, zero registration, and zero shared quota.
3. **Do not build any OAuth login.** Not HN (nothing exists), not Reddit (approval-gated *and* shared quota), not X (billed to us per read), not YouTube (100 search calls/day for the entire extension, and "you must not ... **embed your API Credentials in open source projects**" — [YouTube Developer Policies III.D.1.c](https://developers.google.com/youtube/terms/developer-policies)).
4. **Optional, later, off by default: bring-your-own-credentials as a power-user escape hatch.** This is the *only* configuration where quota resolves in the user's favor. For X, a settings field where the user pastes their own bearer token — legally cleaner because they own the credential and we never possess or distribute it, but get a legal read first: X's Developer Policy says "You may not register multiple applications for a single use case or substantially similar or overlapping use cases" ([policy](https://docs.x.com/developer-terms/policy)), which is aimed squarely at this pattern when a developer orchestrates it at scale. For Reddit, BYO is effectively dead (approval gate + one client_id per lifetime).
5. **If YouTube is ever wanted: enrichment-only, never discovery.** `videos.list` and `commentThreads.list` cost 1 unit each from the 10,000/day pool. `search.list` is capped at "100 quota per day" in its own bucket ([quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost)) — 100 users at one page-view each and we're done for the day — and `q` is free-text over title/description/tags with no by-URL lookup, so Parle's core query shape has no first-class YouTube endpoint at all. Also keep any YouTube results visually separated: "API Clients must not merge or intermix results from sources other than YouTube and present them as YouTube search results."

**Triggers to revisit:** Reddit publishing a per-user-token rate limit or an extension-shaped access tier (neither exists today); a published date for the `.json` shutdown (none exists — the 2026-05-28 r/modnews post says "Logged-in and authenticated access won't be impacted," and the admin clarified "requests without Oauth **or user credentials** will be blocked").

## What still needs a human

| Item | Who / what | Notes |
|---|---|---|
| Reddit client_id | Zendesk approval ticket (form `14868593862164`) | Not self-service since Nov 2025. Nominal 7-day SLA; developers report weeks of silence. Only worth filing if we want to empirically test per-client_id metering — and that ticket is the same gate that blocks the plan. |
| X credits | Funded developer account at `console.x.com` | Signup is self-service (3 steps, no approval queue). The gate is money: zero balance → HTTP 402 `CreditsDepleted` on every request. |
| X Premium check | 10-minute manual check | Open a developer account with a Premium account and see whether the console shows any Premium-derived credit grant. Closes the one negative I could not close empirically. |
| Apple, if OAuth ever ships | Native container-app work + review strategy | `CFBundleURLTypes`, `ASWebAuthenticationSession`, App Group Keychain, plus review notes pre-empting Guideline 4.0 and 5.1.1(v). |
| Chrome listing | Data disclosure update | "Authentication information" checkbox becomes required the moment we hold a token. Not required today. |
| Legal | BYO-key read for X | The "multiple applications for a single use case" clause is the live question. |

## Confidence caveats — things I could not close

- **Reddit's per-client_id metering is documented but unmeasured.** Proving it needs two user tokens under one client_id, and getting a client_id is itself the gate. Reddit's live docs name "per OAuth client id" as the sole unit; no Reddit statement anywhere describes per-user-token metering. Every secondary source agrees but visibly derives from the same two Reddit pages, so I am not counting them as independent.
- **"No X Premium passthrough" is a well-searched negative, not a proof.** The credit model structurally argues against one, but absence of documentation is not proof of absence. See the ten-minute check above.
- **Reddit PKCE support: could not establish.** Not documented anywhere I could find. Stated as could-not-establish, not could-not-exist.
- **Whether an HN session lifts `news.ycombinator.com`'s path-selective 429s: unknown.** Anonymously from a datacenter IP, `/from?site=<domain>`, `/user?id=`, `/threads?id=` and `/login` returned 429 "Sorry." while `/`, `/newest`, `/item?id=` returned 200. I have no HN account to test with, and this may simply be datacenter-IP reputation that is moot on consumer IPs. Either way it argues *against* touching `news.ycombinator.com` directly, not for a login.
- **Algolia's corpus is the full public NON-dead corpus.** Flagged/killed items are excluded (`/api/v1/items/49223501` → 404 while Firebase serves the same item anonymously as `{"dead":true,...}`). That is an *index* gap, not an *auth* gap — Firebase serves dead items keylessly, it just has no URL lookup. Not a reason to log in.
- **`hn.algolia.com` publishes no terms of use at all** — which also means no license granting Parle rights to it. That is a durability risk worth tracking for a shipped product. It is not an argument for a login.
