# Discovery is free and loginless; the Digest requires a connected Provider, ChatGPT first

Finding and listing Discussions needs no AI at all — it is fetching and ranking. Only the Digest, the synthesis across Discussions, needs a model. We split the product along exactly that line: **Discussions are free, loginless, and available on every platform forever; the Digest is unlocked by connecting a Provider.** The headline Provider is "Log in with ChatGPT" via Codex OAuth, which bills the user's own ChatGPT subscription. BYOK and Chrome's on-device Summarizer sit behind the same Effect service as alternate Providers.

## Facts this rests on

- OpenAI's general "Sign in with ChatGPT" is **identity only** — it does not let a third party spend a user's plan. The only token that bills a user's Plus/Pro/Team subscription is the **Codex OAuth** token, which as of April 2026 is scoped to Codex tooling (CLI, IDE extension, Codex Cloud) and used by third-party tools outside that scope.
- **Anthropic prohibited exactly this on 20 Feb 2026 and enforced it in billing on 4 Apr 2026.** OpenAI has not followed, but the precedent exists.
- Chrome's Prompt/Summarizer APIs (Gemini Nano, Chrome 138+) are on-device and free. **Safari has no equivalent**, so on-device can never be the only path given [ADR 0003](./0003-platform-targets.md).

## Considered Options

- **Hosted default on Cloudflare Workers AI** — zero friction, works identically on iOS, and Digests cache per-URL so cost amortizes across everyone reading that page rather than scaling per-user. Rejected in favour of the user's own tokens.
- **BYOK as the default** — bulletproof and free to us, but "paste an API key" at first run loses most installs.

## Consequences

- **Provider risk is contained.** If OpenAI restricts Codex OAuth, the Digest degrades to "connect a different Provider" and the entire discovery product keeps working. This is the main reason the free/AI line is drawn here rather than anywhere else.
- Every Provider sits behind one Effect service with swappable layers; no calling-code knows which Provider is active.
- The v1 demo path has no AI dependency, so a demo cannot be broken by another company's policy change.
- Users without a paid ChatGPT plan get a genuinely useful product rather than an upsell wall — which is what keeps the "accessible to everyone" goal honest.
