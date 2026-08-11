# In what order do Discussions appear, and how is disagreement between them shown?

Type: grilling
Status: open
Blocked by: 01, 07

## Question

Blocked on ticket 01 (which Networks the MVP actually has) and ticket 07 (the prototype that makes this concrete rather than theoretical).

- **Ordering.** Score, recency, comment count, and Network are all incommensurable — 400 points on Hacker News is not 400 upvotes on Reddit. What is the ranking function, and is it one merged list or grouped by Network?
- **The two tiers.** Linked Mentions and Topical Mentions must be visibly distinct and never blended ([CONTEXT.md](../../../CONTEXT.md)). Does that mean two sections, a badge, or something else? What happens when there are twenty Topical Mentions and one Linked Mention?
- **Duplicates.** The same article is often submitted to Hacker News three times and to four subreddits. Do we collapse them, and on what key? Collapsing loses the fact that it was discussed repeatedly, which is itself signal.
- **What each row shows.** Enough to decide whether to click, without becoming a wall: Network, title if it differs from the Subject's, score, comment count, age, community, and — the interesting one — a top comment. Which top comment, and chosen how?
- **Disagreement.** When Discussions conflict, does the list surface that, or is it purely the Digest's job? This is the heart of the product's purpose and the easiest thing to lose to a plain sorted list.
- **Nothing found.** What does the panel say, distinguishing "nothing exists" from "we couldn't reach a Network" from "X was skipped because nothing else was found"?

**The decision:** the ranking function and the panel's information architecture.
