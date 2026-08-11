# What exactly do we tell users and reviewers about what this extension does?

Type: grilling
Status: open
Blocked by: 03, 08, 09

## Question

Blocked on ticket 03 (the Exclusion List *is* the privacy story), ticket 08 (what iOS actually does, and the accounts), and ticket 09 (the name).

This is the highest-scrutiny artefact in the MVP, and the one most likely to sink it. [ADR 0005](../../../docs/adr/0005-offline-prefilter-before-any-network-lookup.md) means we send **every page the reader visits, minus an exclusion list, to third-party Networks**. [ADR 0001](../../../docs/adr/0001-x-access-via-user-session.md) means we issue **authenticated requests using the reader's own X session, automatically**, and requires plain disclosure in the store listing, the README, the first-run screen, and the Apple privacy manifest.

- **The honest sentence.** One sentence describing the Lookup behaviour that is true, comprehensible, and does not read as spyware. It has to survive both a reviewer and a skeptical Hacker News comment thread.
- **The X disclosure.** What we say about using the reader's session, what it can cost their account, and where they turn it off. This must be visible before the first X request, not buried in settings.
- **Apple privacy manifest and Chrome data-use disclosures.** What categories do we declare, given we collect nothing centrally in the MVP but do transmit URLs to third parties?
- **Permissions justification.** Broad `host_permissions`, content scripts on `reddit.com` / `x.com` / `news.ycombinator.com`, dynamic injection. Each needs a defensible reason in review.
- **Rejection plan.** [ADR 0001](../../../docs/adr/0001-x-access-via-user-session.md) requires a build flag compiling X out. What is the actual sequence if Apple or Google rejects — resubmit without X, appeal, or ship Chrome-only first?
- **First-run.** What the reader sees before anything fires, and what they must actively choose versus merely be told.

**The decision:** the listing copy, disclosure text, privacy manifest entries, permission justifications, and the rejection contingency.
