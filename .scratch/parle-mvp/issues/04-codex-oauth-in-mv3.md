# Does Codex OAuth work inside an MV3 extension, on Chrome and on iOS Safari?

Type: research
Status: resolved

## Question

[ADR 0004](../../../docs/adr/0004-ai-is-an-upgrade-not-a-dependency.md) makes "Log in with ChatGPT" the headline Provider, using the **Codex OAuth** token — the only OpenAI token that bills model calls to a user's Plus/Pro/Team subscription. Established during charting: OpenAI's general "Sign in with ChatGPT" is identity only and does **not** grant subscription usage; as of April 2026 the Codex token is scoped to Codex tooling, though third-party tools use it; and **Anthropic prohibited the equivalent on 20 Feb 2026 and enforced it in billing on 4 Apr 2026**.

Find out, from primary sources and by trying it:

- **The flow.** What exactly does the Codex OAuth handshake require — PKCE, redirect URI, client identification? Can a browser extension complete it, and what redirect URI can an extension actually register? Does `browser.identity.launchWebAuthFlow` work here, and does Safari (desktop and iOS) support it?
- **Token lifecycle.** Where is the token stored so it survives an MV3 service worker terminating? How does refresh work, and what happens when refresh fails mid-Digest?
- **Endpoints and shape.** Which endpoint does the token authorise, what request shape, what models, what rate limits per subscription tier? Is streaming available?
- **Terms.** What do OpenAI's current terms say about non-Codex clients using this token? Not to decide whether we proceed — [ADR 0004](../../../docs/adr/0004-ai-is-an-upgrade-not-a-dependency.md) already did — but so the risk is stated accurately in the README and the store listing, and so we know what breaks if it is withdrawn.
- **The fallbacks.** Confirm BYOK works on both platforms, and confirm Chrome's Summarizer/Prompt API availability and its actual quality on a long multi-thread synthesis.

**The decision:** whether Codex OAuth is buildable as specified, and if not, which Provider leads instead.

## Answer

Resolved by the research sweep of 2026-08-08 (37 agents, adversarially verified). Full findings: [research/ticket-04.md](../research/ticket-04.md).
