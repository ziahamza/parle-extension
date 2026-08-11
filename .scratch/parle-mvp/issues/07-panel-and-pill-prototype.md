# What do the pill and the panel look like, and how do they behave as results arrive?

Type: prototype
Status: open

## Question

Make something rough and concrete to react to, rather than arguing about it in prose. Build it with `/prototype` and link the artifact from this ticket.

Constraints already fixed: a toolbar action plus an in-page pill in a Shadow DOM; the panel must be able to host a streaming conversation even though v1 only renders a Digest into it ([ADR 0008](../../../docs/adr/0008-design-both-features-ship-discovery-first.md)); every contested flag renders a clickable citation ([ADR 0006](../../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md)); Linked Mentions and Topical Mentions are visibly distinct and never blended.

The behaviour that makes this hard is **progressive arrival**. Results come in three waves: the Local Discussion Cache answers instantly and offline; HN and Reddit arrive over the network; X arrives last, and only if one of the others found something ([ADR 0001](../../../docs/adr/0001-x-access-via-user-session.md)). So:

- What does the pill show at each stage, and how does its count change without feeling like it's flickering or lying?
- What does "we're still looking" look like, versus "we looked and there's nothing", versus "X was skipped because nothing else was found"?
- How do the degraded states render — index stale, Shared Digests unavailable, X unavailable, no Provider connected ([ADR 0011](../../../docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md) requires these be states, not errors)?
- Where does the "connect ChatGPT to see a Digest" prompt live, so it reads as an upgrade rather than a paywall ([ADR 0004](../../../docs/adr/0004-ai-is-an-upgrade-not-a-dependency.md))?
- How does the panel work on an iPhone, where it is small, and where the toolbar entry point may behave differently ([ADR 0003](../../../docs/adr/0003-platform-targets.md))?
- How does the pill avoid breaking the host page's layout, and what does the reader do when it's in the way?

**The decision:** the interaction model for pill and panel, evidenced by a prototype rather than a description.
