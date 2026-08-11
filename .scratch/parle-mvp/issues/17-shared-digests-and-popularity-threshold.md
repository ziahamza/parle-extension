# What makes a Subject popular enough for a Shared Digest, and what does it cost?

Type: grilling
Status: open
Blocked by: 11, 16

## Question

Blocked on ticket 11 (the prompt and its token cost) and ticket 16 (the pipeline that knows what is popular).

[ADR 0007](../../../docs/adr/0007-shared-digests-are-gated-by-popularity.md) makes Shared Digests the mechanism by which a reader with no Provider still gets a Digest on the pages most people are reading — and the threshold is the cost dial.

- **The threshold.** What combination of aggregate Discussion activity — score, comment count, number of Discussions, velocity — puts a Subject over the line? Note it must be **tunable from the artifacts without shipping a build** ([ADR 0007](../../../docs/adr/0007-shared-digests-are-gated-by-popularity.md)), which shapes where the logic lives.
- **Cost model.** At a given threshold, how many Subjects qualify per day, at what token cost, on which model? What is the monthly bill, and what is the runaway scenario if something goes viral or someone abuses the on-demand path?
- **Change detection.** [ADR 0007](../../../docs/adr/0007-shared-digests-are-gated-by-popularity.md) needs a cheap signal that Discussions have moved, without re-fetching every comment. Score and comment-count deltas from list endpoints are the obvious candidate — is that enough, and how much drift before a rewrite is warranted?
- **Abuse.** On-demand generation triggered by clients is a spend endpoint someone can point traffic at. What bounds it?
- **The crossover.** A Subject can move from Local to Shared. [ADR 0007](../../../docs/adr/0007-shared-digests-are-gated-by-popularity.md) requires the reader notice nothing except that it got faster. What does the client do when both exist and they disagree? (Now a precedence rule: no diff is surfaced, so whichever Digest is current wins.)

**The decision:** the threshold definition, the cost model and its guardrails, and the change-detection and rewrite mechanism.
