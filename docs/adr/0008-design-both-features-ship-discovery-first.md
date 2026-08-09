# Both features are designed together; v1 ships discovery only

The product has two halves: **discovery** (what has the internet already said about this page) and **fact-check** (select a passage, interrogate it with AI). This effort designs both as one coherent product. **v1 ships discovery only**; fact-check follows as v2 on the same architecture.

## Why not ship both at once

v1 reaching real users quickly matters more than launching complete, and App Review is on the critical path ([ADR 0003](./0003-platform-targets.md)). A discussion-finder requesting `x.com` session access ([ADR 0001](./0001-x-access-via-user-session.md)) is a materially easier first submission than a fact-checking product requesting the same thing. Meeting review a second time, with an approved app and a track record, is a better position for the riskier half.

## What designing-both obliges v1 to do

These are v1 requirements, not v2 concerns. They are cheap now and expensive to retrofit:

- **The panel hosts a conversation, not a document.** Its layout, scroll behaviour, and state model must accommodate streaming multi-turn exchange from the start, even though v1 only ever renders a Digest into it.
- **The Provider service is chat-shaped.** The Effect service abstracting Codex OAuth / BYOK / on-device exposes streaming multi-turn completion, not one-shot summarization, even though v1 only calls it one way.
- **The content script owns text selection from day one**, including the selection-to-anchor mapping that survives DOM mutation and SPA navigation. This is the hardest part of fact-check and the part most damaged by being added late.
- **Citations are a shared component.** [ADR 0006](./0006-the-digest-reports-it-does-not-adjudicate.md) already requires every contested flag to link its evidence; fact-check has the same requirement. One component serves both.

## Consequences

- The fact-check half carries all the adjudication risk ADR 0006 deliberately kept out of the Digest. Its design must resolve, at minimum: what a claim is, where verdicts are sourced, how it fails safely, and who pays for it. Those are open questions on the map, not settled here.
- v1's architecture will contain capability it does not yet use. That is intentional; reviewers should not "simplify" the streaming Provider interface or the selection machinery on the grounds that nothing calls them yet.
