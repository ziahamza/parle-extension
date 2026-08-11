# How is the Local Discussion Cache harvested, keyed, stored, and evicted?

Type: grilling
Status: open

## Question

[ADR 0012](../../../docs/adr/0012-local-discussion-cache-built-from-browsing.md) commits to a per-user cache mapping Subject URL to where its Discussions live, filled by harvesting the Networks the reader already browses. It is the mechanism that makes the two experiences the user cares most about — arriving from a Network, and clicking a link *on* a Network — instant and free. Design it.

- **Harvest surface per Network.** What exactly do we read on a Hacker News list page, a Reddit listing, a Reddit comment page, and an X timeline? What metadata comes along (thread id, score, comment count, subreddit, timestamp)? How do we harvest without the selectors breaking every time a Network reskins — and what happens when they do break?
- **Redirect resolution.** X rewrites outbound links through `t.co`, Reddit through its own trackers. [ADR 0012](../../../docs/adr/0012-local-discussion-cache-built-from-browsing.md) requires resolving these to the destination **at harvest time** so the cache is keyed on the real URL before the click. How, batched how, capped how? A busy timeline is a lot of unresolved links.
- **Opportunistic prefetch.** When the reader is on a Network, how much more do we pull than what's on screen? What is the request budget and daily cap for the small amount of scheduled prefetch allowed on top?
- **Storage and eviction.** IndexedDB schema; size ceiling sized for **iOS Safari**, which is the constraining platform; eviction policy (LRU, age, score); what "clear my cache" does and where the reader finds it.
- **Staleness.** A cache hit renders immediately, then reconciles. What triggers reconciliation, and what does the panel do when the fresh answer differs from the cached one?

**The decision:** the cache's data model, harvest strategy per Network, and storage/eviction policy — enough to build.
