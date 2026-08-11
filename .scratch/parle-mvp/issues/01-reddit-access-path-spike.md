# Can the extension reach Reddit from a real browser, and by which path?

Type: prototype
Status: resolved

## Question

This is the highest-risk unknown in the whole map. [ADR 0011](../../../docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md) puts every Network connector in the client, and [ADR 0001](../../../docs/adr/0001-x-access-via-user-session.md) gates X behind HN or Reddit having found something. If the browser cannot reach Reddit, the MVP loses a Network *and* the mechanism that bounds X.

Measured during charting: `https://www.reddit.com/api/info.json?url=…` returns **403** from a datacenter IP with a browser User-Agent. That proves nothing about a user's own machine, and the difference decides the architecture.

Build a throwaway extension and test, from a real residential browser, each path end to end:

1. **`fetch` from the extension carrying the user's cookies** (`host_permissions` on `reddit.com`) — logged in and logged out. Does `api/info.json?url=` work? Does `search.json?q=url:`? Does `old.reddit.com` differ from `www`? What happens at volume?
2. **Registered OAuth app, userless `installed_client` grant** — note the `client_id` is public in an AGPL repo and Reddit's free limit is per-client-id (~100 req/min across *all* users), so establish whether that ceiling is survivable at any realistic install count.
3. **Content-script fetch from a `reddit.com` tab** rather than the background worker, if 1 fails — does origin matter?

Report for each: works or not, logged-in vs logged-out, what rate limit bites and when, what the failure mode looks like (403, 429, CAPTCHA, silent empty), and whether it survives an hour of normal browsing.

**The decision:** which path Reddit uses in the MVP — and, if none work, whether the MVP ships HN-only, which would force ticket 10 and [ADR 0001](../../../docs/adr/0001-x-access-via-user-session.md)'s runtime gate to be reconsidered.

## Answer

Resolved by the research sweep of 2026-08-08 (37 agents, adversarially verified). Full findings: [research/ticket-01.md](../research/ticket-01.md).
