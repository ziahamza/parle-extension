/**
 * Which links on a Network page are worth harvesting at all.
 *
 * A Network page is mostly links to itself: user profiles, subreddit sidebars,
 * "next page", the site's own media CDN. Harvesting those would fill the Local
 * Discussion Cache with Mentions claiming that a Hacker News thread is about a
 * Hacker News user page, which is not merely wasteful — it is a claim, stored
 * with evidence, that the panel would later render.
 *
 * Two hosts look internal and are not: **`t.co`**, through which every outbound
 * link on X is rewritten, and **`out.reddit.com`**, through which Reddit
 * rewrites its own. Both belong to a Network by domain and to somewhere else
 * entirely by purpose — they exist to send the reader away — so treating them
 * as part of the Network would silently discard the entire reason ADR 0012
 * exists. They are named in {@link outward}, which outranks everything below,
 * and {@link ./Shortlinks.ts} unwraps or follows them.
 *
 * Media hosts are excluded for a different reason from site hosts: `i.redd.it`
 * and `pbs.twimg.com` are real public addresses that would canonicalize
 * perfectly well, and a Mention keyed on an image is a cache entry that can
 * never be hit, because nobody reads an image in a top-level frame and asks
 * what was said about it.
 */
import type { Network } from "@parle/domain/Network"

const own = {
  hackernews: ["news.ycombinator.com", "hn.algolia.com"],
  reddit: [
    "reddit.com",
    "redd.it",
    "redditstatic.com",
    "redditmedia.com",
    "reddithelp.com",
    "redditinc.com"
  ],
  // `t.co` is deliberately absent: it is X's outbound wrapper, not X's site.
  x: ["x.com", "twitter.com", "twimg.com", "twitter.co"]
} satisfies Record<Network, ReadonlyArray<string>>

/**
 * A Network's own outbound wrappers, which are outbound by definition.
 *
 * Checked before {@link own}, because `out.reddit.com` is a subdomain of
 * `reddit.com` and would otherwise be filtered out as part of Reddit — losing
 * every link Reddit rewrote, which is most of them.
 */
const outward: ReadonlyArray<string> = ["out.reddit.com", "t.co"]

/** True when the host is `suffix` itself or a subdomain of it. */
const under = (host: string, suffix: string): boolean => host === suffix || host.endsWith(`.${suffix}`)

/**
 * True when this address is somewhere else — a page the Network's readers were
 * sent to, rather than another part of the Network.
 */
export const isOutbound = (network: Network, url: string): boolean => {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (outward.some((suffix) => under(host, suffix))) return true
  return !own[network].some((suffix) => under(host, suffix))
}
