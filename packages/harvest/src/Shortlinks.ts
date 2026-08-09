/**
 * Which links have to be followed, and which can be unwrapped for nothing.
 *
 * ADR 0012's last consequence is a budget: "shortlink resolution at harvest
 * time costs a request per unresolved link. It must be batched, cached, and
 * capped, or harvesting a busy timeline becomes its own traffic problem." A
 * single X timeline can carry forty `t.co` links, so the cheapest way to stay
 * under a cap is to spend nothing on the links that never needed a request.
 *
 * Two kinds of rewriting exist and they are not alike:
 *
 *   - **Wrappers** carry the destination in the URL itself —
 *     `out.reddit.com/?url=…`, `www.google.com/url?q=…`. {@link unwrap} reads
 *     it back with no request at all, and this is the majority of Reddit's
 *     outbound rewriting.
 *   - **Shorteners** carry an opaque token — `t.co/x7Kd2`, `bit.ly/3abc` —
 *     and there is no way to learn the destination but to ask.
 *
 * The host lists are enumerated and therefore incomplete by nature, exactly
 * like the Exclusion List, and the failure mode of missing one is mild and
 * self-correcting: an unlisted shortener is treated as a destination, the
 * Mention is keyed on the shortlink, and the reader loses a cache hit rather
 * than gaining a wrong one. That asymmetry is why {@link isShortener} is a
 * whitelist and not a heuristic on path length: guessing "short path means
 * shortener" would send requests to ordinary pages and key real Subjects on
 * whatever those pages redirected to.
 */
import * as Option from "effect/Option"

/**
 * Hosts that answer a redirect and nothing else.
 *
 * `t.co` is the one that matters — every outbound link on X goes through it,
 * including links inside a quoted post — and it is why resolution has to happen
 * at harvest time rather than on arrival.
 *
 * A host belongs here only if it *redirects*. `hn.algolia.com` was listed and
 * does not: it is a search page that answers `200` at the address it was asked
 * about, so every Algolia link seen on Reddit or X spent a request to learn
 * nothing. Being wrong in this direction is not free — it is the one list in
 * this file whose entries cost the budget ADR 0012 caps.
 */
const shorteners: ReadonlySet<string> = new Set([
  "t.co",
  "bit.ly",
  "buff.ly",
  "ow.ly",
  "tinyurl.com",
  "goo.gl",
  "dlvr.it",
  "ift.tt",
  "trib.al",
  "lnkd.in",
  "rb.gy",
  "is.gd",
  "shorturl.at",
  "tiny.cc",
  "redd.it",
  "reddit.app.link"
])

/** Hosts that put the destination in a query parameter. */
const wrappers: ReadonlySet<string> = new Set([
  "out.reddit.com",
  "www.google.com",
  "news.google.com",
  "l.facebook.com",
  "lm.facebook.com",
  "href.li",
  "www.youtube.com"
])

/**
 * The parameters a wrapper hides the destination in.
 *
 * Ordered: `url` before `u` before `q`, because `www.google.com/url?q=…&sa=…`
 * and `l.facebook.com/l.php?u=…&h=…` both carry decoy parameters and a
 * first-match-wins scan over an unordered set would occasionally pick one.
 */
const destinationParameters: ReadonlyArray<string> = ["url", "u", "q", "target", "to", "redirect_uri"]

const hostOf = (raw: string): string | null => {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** True when learning this link's destination costs a request. */
export const isShortener = (raw: string): boolean => {
  const host = hostOf(raw)
  return host !== null && shorteners.has(host)
}

/**
 * Read a wrapped destination straight out of the URL, if it is there.
 *
 * Returns `None` for a wrapper host whose parameters carry no absolute
 * `http(s)` address — `www.youtube.com/watch?v=…` is on the wrapper list for
 * its `/redirect?q=` form and must not have its `v` parameter mistaken for a
 * destination — and for anything that is not a wrapper at all.
 *
 * The result is deliberately NOT canonicalized here. Canonicalization is the
 * one rules table this system has, it lives in `@parle/policy`, and a second
 * one in this file would be a silent second key space.
 */
export const unwrap = (raw: string): Option.Option<string> => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return Option.none()
  }
  if (!wrappers.has(url.hostname.toLowerCase())) return Option.none()
  for (const name of destinationParameters) {
    const value = url.searchParams.get(name)
    if (value === null) continue
    // `URLSearchParams` has already percent-decoded once; a wrapper that
    // double-encoded is rare and one more decode would corrupt an honest `%25`.
    if (/^https?:\/\//i.test(value)) return Option.some(value)
  }
  return Option.none()
}

/**
 * Unwrap repeatedly, because trackers nest.
 *
 * A Reddit post shared from a Google News link arrives as
 * `out.reddit.com/?url=https%3A%2F%2Fnews.google.com%2F...%3Furl%3D…`. The
 * bound is small and fixed: this is a loop over a string, not over requests, so
 * the only thing it can cost is a pathological input, and three passes covers
 * every nesting anyone has observed.
 */
export const unwrapFully = (raw: string): string => {
  let current = raw
  for (let pass = 0; pass < 3; pass++) {
    const inner = unwrap(current)
    if (Option.isNone(inner)) return current
    current = inner.value
  }
  return current
}
