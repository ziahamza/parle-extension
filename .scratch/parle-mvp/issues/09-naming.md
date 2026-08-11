# Is it called Parle?

Type: grilling
Status: claimed

## Question

The repo is `parle`. Nothing has confirmed that as the product name, and it is needed to submit to either store, so it blocks ticket 12.

- Does "Parle" survive contact with the product? It reads as *to speak* — apt for a product about what people are saying, and it carries a nice echo of *parley*: talking across a divide. It is also unfamiliar to English speakers, hard to spell from hearing it, and dominated in search results by an existing snack brand.
- Is the name available where it matters — Chrome Web Store, App Store, npm, a domain, GitHub org, and the obvious social handles?
- Does it collide with anything in the fact-checking, news, or moderation space, given [ADR 0006](../../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md) means we will be adjacent to some contentious products?
- What does the extension call *itself* in the UI, in the singular — the pill's tooltip, the panel header, the first-run screen?
- The domain terms in [CONTEXT.md](../../../CONTEXT.md) (Subject, Discussion, Digest, Spread, Linked Mention) are internal vocabulary. Which of them, if any, are also the words we use to readers? "Digest" is probably user-facing; "Subject" almost certainly is not.

**The decision:** the product name, and the user-facing vocabulary that goes with it.

## Answer

**Deferred by decision, 2026-08-08.** The product ships under the working name `parle` while the MVP is built end to end; the rename happens before the first store submission, not before the first line of code. The evidence is banked and does not need regathering: [research/ticket-09-naming-shortlist.md](../research/ticket-09-naming-shortlist.md) (71 candidates generated, 23 cleared empirical availability, top pick **Elsewire** with .io/.ai/.dev/.so/.co free, npm and GitHub free, zero US trademark records) and [research/ticket-09.md](../research/ticket-09.md) for the case against keeping Parle.

Re-open this before ticket 12. Note the two `.com`/`.app` domains for the leading candidate expire in December 2026 and are backorderable.
