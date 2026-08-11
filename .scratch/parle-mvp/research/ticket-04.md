# Research: ticket 04 — Does Codex OAuth work inside an MV3 extension, on Chrome and on iOS Safari?

## Answer

### Bottom line

**Partly — and nobody, including us, has yet completed a single end-to-end Codex OAuth login from a browser extension on either platform.** What is established is narrower than the ticket assumed:

- **The route the ticket assumed is dead.** `identity.launchWebAuthFlow` does not exist in Safari or Safari iOS (**measured** against `@mdn/browser-compat-data` v8.0.10: `version_added: false` for `safari` and `safari_ios`, for both `launchWebAuthFlow` and `getRedirectURL`), and Apple states it outright: "identity — Not supported. Initiate an OAuth flow in a new tab" ([Apple](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)). So the `chromiumapp.org` redirect-URI question is Chrome-only *at best* and cannot serve the Safari/iOS target at all.
- **There is a redirect-free path that is plausibly viable on both platforms** — OpenAI's private device-code flow — but it is undocumented internal surface, and only its *first* leg has ever been observed succeeding.
- **The bigger risk is not auth, it is the API call on Safari.** `chatgpt.com/backend-api/*` sends no `Access-Control-Allow-Origin`. Chrome MV3 background service workers documented-ly bypass CORS with `host_permissions`; Safari's behaviour here is undocumented and unverified. If Safari enforces CORS, login succeeds on iOS and the Digest silently dies.

**Recommendation: do not make Codex OAuth load-bearing.** Build the Digest against a provider interface, ship **BYOK as the primary, contractual provider**, and treat Codex OAuth as an opportunistic Chrome-first implementation gated behind two experiments (below). Do not write the ADR until those two run.

---

### What is actually measured (re-verified today, 2026-08-08 ~03:54 UTC, datacenter IP, no session)

| Probe | Result |
|---|---|
| `POST auth.openai.com/api/accounts/deviceauth/usercode`, `{"client_id":"app_EMoamEEZ73f0CkXaXp7hrann"}`, `Origin: chrome-extension://…` | **HTTP 200**, `access-control-allow-origin: *`, body `{"device_auth_id":"deviceauth_6a76a861…","user_code":…,"interval":"5"}` |
| `POST /api/accounts/deviceauth/token` (poll) | **403** `deviceauth_authorization_pending` (i.e. keep-polling state, *not* a success observation) |
| `POST /oauth/token` with bogus code | **401** `token_expired` (endpoint reachable; proves nothing about the happy path) |
| `OPTIONS` preflights on all three | **200**, `ACAO: *`, `allow-headers: content-type` |
| `POST chatgpt.com/backend-api/codex/responses`, `Origin: chrome-extension://…` | **401** `{"detail":"Could not parse your authentication token…"}`, **no `access-control-allow-origin` header** |
| `POST chatgpt.com/backend-api/wham/responses` | **401** (alias live) |
| `POST chatgpt.com/backend-api/codex/v1/responses` | **403, `cf-mitigated: challenge`** — Cloudflare interstitial, not a clean 401 |
| `GET auth.openai.com/codex/device` (the page the *user* visits), followed | **403 Cloudflare managed challenge**, even with a Chrome UA |

The client id `app_EMoamEEZ73f0CkXaXp7hrann` is real and live: OpenAI's own server emits it in the 307 from `/api/accounts/deviceauth/authorize`, and it authenticates with no `client_secret` (a fabricated id gets `401 invalid_client`; this one gets past client auth and fails only on the code). Discovery advertises `token_endpoint_auth_methods_supported: [...,"none"]` and `code_challenge_methods_supported: ["S256"]`.

### Claims I am explicitly discarding or correcting

These were asserted during research and **refuted on verification** — do not carry them forward:

1. ~~"I verified all three legs of the device flow."~~ **False.** Only leg 1 was seen succeeding. Legs 2 and 3 were seen only in error states. **The happy path is unverified by anyone.**
2. ~~"It is a device authorization (RFC 8628) flow."~~ **False.** Discovery advertises no `device_authorization_endpoint`; `/oauth/token` rejects `grant_type=urn:ietf:params:oauth:grant-type:device_code` with "Unknown parameter: 'device_code'"; the standard endpoints 403. It is a bespoke internal endpoint set with **no public contract**. Its PKCE is decorative — `/api/accounts/deviceauth/authorize` returns a byte-identical static `code_challenge` on every request and the server hands the client the verifier.
3. ~~"Fully usable from a browser extension, verified from a datacenter IP."~~ The *human* leg was never verified — `auth.openai.com/codex/device` is Cloudflare-gated from server IPs. It very likely works for a real user on a residential IP; that is an assumption.
4. ~~"'Automatically or programmatically extract data or Output' is the most dangerous ToS clause and a plain-reading hit."~~ **Overstated.** That bullet sits under "You may not use our Services for any illegal, harmful, or abusive activity. **For example**, you may not:", the same Terms assign Output ownership to the user, and OpenAI itself ships and documents programmatic Codex output consumption under ChatGPT sign-in (Codex SDK, `codex exec --json`, app-server). The clauses that actually bite are *"circumvent any rate limits or restrictions or bypass any protective measures"*, *"reverse engineer… underlying components"*, and Registration's credential-sharing prohibition.
5. ~~"OpenAI has published nothing about intended credential use."~~ **Not true.** [learn.chatgpt.com/docs/auth](https://learn.chatgpt.com/docs/auth) scopes "Sign in with ChatGPT" to "the ChatGPT desktop app, Codex CLI, and IDE extension" and says "Use API key authentication for programmatic Codex CLI workflows." That is soft and non-prohibitive, but it is a published statement of intent, and it is the surface where a restriction would appear.
6. ~~"openai/codex#36886 is OpenAI-triaged."~~ Its labels were applied by `github-actions[bot]` 44 seconds after creation. With 11,715 open issues and 35% of that week's issues at zero comments, its silence proves nothing.
7. ~~"There is no client-registration process for third parties."~~ Unsupported by the evidence given (a grep of Codex's source cannot establish it), and likely stale — "Sign in with ChatGPT" reportedly entered partner beta 2026-08-02 (**secondary sources only**; not confirmed against an OpenAI primary source), and it grants identity only, not plan-backed inference.

### Chrome (MV3): plausible, unproven

**Documented + measured:** device-flow endpoints are CORS-open to a `chrome-extension://` origin; Chrome background service workers bypass CORS with `host_permissions` and must be used ("cross-origin requests are always treated as such in content scripts, even if the extension has host permissions" — [Chrome docs](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)). So: extension shows a code → user opens `auth.openai.com/codex/device` in a tab → extension polls → exchanges at `/oauth/token` → calls `chatgpt.com/backend-api/codex/responses` with `Authorization: Bearer` + `ChatGPT-Account-Id` (decoded from the JWT's `https://api.openai.com/auth` claim, no extra network call).

**Inferred, not measured:** the authorization-code alternative is very likely closed to us. Codex builds its redirect from a bound TCP listener (`server.rs:60/62/176`, ports 1455/1457) with the source comment *"Keep in sync with the Codex CLI Hydra redirect URI allow-list"*, and a whole-repo grep finds only those two loopback URIs plus `https://auth.openai.com/deviceauth/callback`. I could **not** measure whether Hydra would accept `https://<ext-id>.chromiumapp.org/` — `/oauth/authorize` returns `403 cf-mitigated: challenge` from any datacenter IP for *every* redirect_uri including the known-good one. Treat "allowlist rejects us" as strong inference, not fact. (The webNavigation-intercept-of-localhost-1455 trick is **speculation**, Chrome-only, and collides with a locally running Codex CLI. Do not plan on it.)

**Service-worker lifecycle constrains the Digest regardless of provider** ([Chrome docs](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)): worker dies if a `fetch()` response takes >30s to arrive, and hard-caps at 5 minutes per request. Use SSE (`Accept: text/event-stream`) — which this endpoint speaks natively — or drive it from an extension page/offscreen document.

### iOS Safari: the auth half is plausible, the API half is the open blocker

- **Auth:** the device flow needs no `identity` API, no redirect URI, and no socket. Apple's own guidance ("initiate OAuth in a new tab") is exactly this shape. Plausible — **untested**.
- **API call:** unresolved and decision-critical. `chatgpt.com/backend-api` sends no ACAO. Whether Safari grants extension background contexts the same host-permission CORS bypass Chrome documents is **undocumented**. There is a known Safari defect history where `host_permissions` granted cross-origin fetch to background *pages* but not background *service workers* ("Fetch API cannot load … due to access control checks"), reported fixed in 16.4 with developer reports continuing after; current-Safari status **unknown**. Compounding: iOS Safari extension service workers have a multi-year reported failure (permanently killed ~30–45s after install, Apple Forums 758346, wxt-dev/wxt#656), with the documented workaround being a `scripts` + `persistent:false` background — i.e. the *page* environment, which is also the environment where the CORS bypass historically worked. These two point the same way: **on Safari, prefer a background page over a service worker.**
- Not a blocker here: the Safari 18 `fetch()`-drops-credentials regression (FB15307169) is about cookies. Codex OAuth is bearer-token, so it is unaffected. That bug threatens the X/Reddit connectors, not this.

### Additional constraints that must land in the design

- **Trust/UX hazard (documented):** Codex's own device prompt tells users *"Continue only if you started this login in Codex. If a website or another person gave you this code, cancel."* — on a Codex-branded page. An extension handing a user a device code is literally the pattern users are told to abort. This is a real conversion and trust cost, not a footnote.
- **Workspace users are locked out (reported):** device auth is admin-gated off by default on Team/Business/Enterprise with no discoverable admin toggle (openai/codex #9418, #9282, #9253, #9327). Surface "contact your workspace admin" explicitly and route to BYOK.
- **Quota is shared with the user's coding work (documented):** a 5-hour rolling window plus weekly caps ([learn.chatgpt.com/docs/pricing](https://learn.chatgpt.com/docs/pricing)). Read `RateLimitSnapshot` off responses; **never auto-summarize** — the Digest must be explicitly user-initiated.
- **OpenAI is instrumenting for exactly this (documented):** openai/codex PR #31649 (merged 2026-07-08) — *"Device authorization requests currently omit Codex client identity metadata, which limits detection and investigation of third-party reuse of the device flow."* Telemetry-only today, by their own statement. The gating lever already exists client-side: `is_first_party_originator()` (`auth/default_client.rs:148`) matching `codex_cli_rs`/`codex-tui`/`codex_vscode`/`Codex *`, currently wired only to a client-side feature gate.
- **Send our own `originator: parle`. Never impersonate `codex_cli_rs`.** Impersonation is the conduct that maps onto the "bypass protective measures" clause, and it is what triggered Anthropic's legal request to OpenCode (sst/opencode PR #18186, merged 2026-03-19). An honest originator also makes Parle nameable/allowlistable rather than anonymous traffic swept up in action aimed at someone else.
- **Path ambiguity is unresolved.** `/backend-api/codex/responses` and `/backend-api/wham/responses` both 401 (live); `/backend-api/codex/v1/responses` 403s behind Cloudflare from here. Pick one behind an adapter and expect to change it.
- **Refresh tokens rotate single-use** (`refresh_token_reused` is a hard failure); persist atomically. **Access-token lifetime is unknown** — clients default to 3600s when `expires_in` is absent, which suggests it may be absent.
- **License is clean:** openai/codex is Apache-2.0, opencode is MIT — both one-way compatible into AGPL-3.0. The client id is an identifier constant, not copyrightable expression. **AGPL commitment: CONFIRMED, unthreatened.** The exposure is contractual, not licensing.

### Policy status, stated honestly

OpenAI's US Terms (eff. 2026-01-01) and Service Terms contain **no clause addressing third-party clients using a subscription-derived token**. (Note: `row-terms-of-use` is a near-duplicate of the US terms, *not* the EEA doc; the EEA/CH/UK doc is `eu-terms-of-use`, "Europe Terms of Use", updated 2026-01-16, contracted with OpenAI Ireland Ltd — the prohibitions there are substantively equivalent but textually distinct.) I found **zero** evidence of enforcement against a third-party Codex-OAuth client; every 403 traced to root cause was Cloudflare bot-mitigation or client misconfiguration. OpenAI has publicly named third-party harnesses approvingly ([developers.openai.com/community/codex-for-oss](https://developers.openai.com/community/codex-for-oss)).

Contrast with the only vendor that *has* spoken: Anthropic **prohibits** it in writing — "Anthropic does not permit third-party developers to offer Claude.ai login or to route requests through Free, Pro, or Max plan credentials on behalf of their users… may do so without prior notice" ([code.claude.com/docs/en/legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)). So the correct framing is **permitted-by-silence, revocable at will** — weaker ground than "documented elsewhere," stronger than "prohibited."

The Anthropic precedent's *end state* is instructive and milder than a shutdown: ban → backlash → **metering** (third-party agent usage reinstated 2026-06-15 against a separate API-rate credit pool). **Inferred, not established:** if OpenAI copies that, Parle's Digest doesn't break — it quietly starts consuming a metered budget the user wanted for their coding agent. Plan for degradation, not decapitation.

### Impact on our architectural commitments

- **"Works with NO backend deployed" — CONFIRMED on Chrome, THREATENED on Safari/iOS.** Not by auth (device flow needs no server) but by the CORS-bypass unknown on `chatgpt.com/backend-api`.
- **"AI Digest powered by Codex OAuth; BYOK and Chrome on-device are fallbacks" — THREATENED, and the ordering should invert.** Codex is undocumented, revocable, admin-gated for workspace users, and carries a hostile-by-design consent page. Meanwhile the "fallbacks" cannot substitute: Chrome's Prompt API context window is **9,216 tokens (measured on Chrome 151.0.7922.75 stable)** and Summarizer is 6,000 — roughly 60–90 average Reddit comments single-pass, versus ~20,000 tokens for a 200-comment thread; it is desktop-Chrome-only (chromestatus: Prompt API on Android = Proposed, no milestone; iOS excluded) behind a **2.7 GB model download** and a 22 GB free-space floor that `create()` refuses without a user gesture. Apple has formally **opposed** the Prompt API (`position: oppose`, [WebKit/standards-positions#495](https://github.com/WebKit/standards-positions/issues/495)); the real iOS path is native messaging → FoundationModels, whose window is **4,096 tokens per session** (~35 comments). **Ranking should be: BYOK (load-bearing) → Codex OAuth (opportunistic, Chrome-first) → on-device (a different, smaller feature — "summarize the top 30 comments", not a citation-bearing Digest).**
- **Reddit 403 / X-via-user-session / Discussion Index / AGPL — UNAFFECTED** by this ticket.

### Next actions

**Blocking the ADR — cannot be settled from this host:**

1. **[Real device, macOS + iOS] Safari cross-origin fetch probe.** Throwaway Safari Web Extension with `https://chatgpt.com/*` in `host_permissions`; fetch `chatgpt.com/backend-api/codex/models` from the background. **Success = a 401 comes back. Failure = a CORS error.** Test *both* background environments (service worker, and `scripts`+`persistent:false` page) — the answer may differ, and prior history says the page environment is the one that works. This is the single highest-value unknown; the Safari/iOS Digest lives or dies on it.
2. **[Residential IP, real ChatGPT account] Complete one device-code login end to end** from an unpacked Chrome extension with `originator: parle`. This is the only way to (a) prove legs 2 and 3, (b) read the real `exp` / whether `expires_in` is returned, (c) confirm `/codex/device` passes for a real user, (d) confirm which `/responses` path actually works, (e) check whether a non-Codex `originator` is already differentiated server-side.
3. **[Residential browser] Re-read OpenAI's live Terms and Usage Policies.** All openai.com policy URLs 403 from datacenter IPs; the Usage Policies text we have is a 5-week-old Wayback capture. Re-verify before any policy claim lands in the ADR.

**Non-blocking, start now:**

4. **Build the provider interface first.** `Provider = { id, isAvailable(), digest(input) → Stream }`. BYOK ships first and is the one that works identically on Chrome desktop and Safari/iOS. Codex is one swappable implementation; a Codex outage must degrade to "pick another provider," never to a broken feature.
5. **Adopt the device flow, not `launchWebAuthFlow`** — the latter cannot serve Safari/iOS at all, and the redirect-URI question is moot under the device flow.
6. **Set `originator: parle` and our own User-Agent.** Never present as `codex_cli_rs`.
7. **Design the honest consent moment.** Users will land on a Codex-branded page warning them to cancel. Explain in-product *before* sending them, or accept a high abandon rate.
8. **Digest is user-initiated only**, streams via SSE (30s-to-first-byte SW rule), reads `RateLimitSnapshot`, and shows remaining quota. Handle `refresh_token_reused`, `access_denied`/`missing_codex_entitlement`, and the workspace admin-gate error with an explicit "switch to BYOK" path.
9. **Monitor, don't assume.** Watch `learn.chatgpt.com/docs/auth` and Codex product docs (not the ToU) — that is where a restriction will appear first — plus `is_first_party_originator` call sites in openai/codex.
