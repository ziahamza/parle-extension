/**
 * The DiscussionSource connectors.
 *
 * Distinct service keys over one shape — one per Network. Import the connector
 * you mean — `HackerNews.HackerNews`, `Reddit.Reddit`, `X.X`, `Bluesky.Bluesky`,
 * `Lemmy.Lemmy`, `Lobsters.Lobsters` — never a `DiscussionSource` that could be
 * any of them. That is what keeps ADR 0001's X gate structurally enforceable
 * and stops a Reddit fake standing in for a Hacker News one.
 *
 * Everything here imports `effect/unstable/http`, which is why it is a separate
 * package from `@parle/domain`: the shared contract stays on stable modules
 * even though HTTP is not.
 */
export * as Address from "./Address.ts"
export * as Bluesky from "./Bluesky.ts"
export * as Discussion from "./Discussion.ts"
export * as HackerNews from "./HackerNews.ts"
export * as Lemmy from "./Lemmy.ts"
export * as Lobsters from "./Lobsters.ts"
export * as Observation from "./Observation.ts"
export * as Recorded from "./Recorded.ts"
export * as Recording from "./Recording.ts"
export * as Reddit from "./Reddit.ts"
export * as RedditPage from "./RedditPage.ts"
export * as Source from "./Source.ts"
export * as Wire from "./Wire.ts"
export * as X from "./X.ts"
