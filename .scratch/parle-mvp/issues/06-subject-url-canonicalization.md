# What are the exact canonicalization rules for a Subject URL, and how do we track SPA navigation?

Type: grilling
Status: open

## Question

The Subject URL is the lookup key for everything — Lookups, the Local Discussion Cache, Linked Mentions, the Discussion Index. Canonicalize too little and the same page is three different keys; too much and distinct pages collide. Both failures are silent.

- **The rules.** Tracking parameters (`utm_*`, `fbclid`, `gclid`, and the long tail); AMP and mobile variants; trailing slashes; `www`; scheme; fragments; case; default ports; index files. Which query parameters are *significant* — `?p=` on WordPress, `?v=` on YouTube, pagination, and per-site exceptions generally?
- **Redirects.** When do we follow one to canonicalize, and when does following one cost a request we shouldn't spend? Interacts directly with ticket 02's harvest-time redirect resolution — the answers must agree.
- **YouTube.** [ADR 0008](../../../docs/adr/0008-design-both-features-ship-discovery-first.md) puts YouTube in scope as a Subject: `youtu.be` shortlinks, `&t=`, playlist context, Shorts. All should canonicalize to one video identity.
- **Publisher hints.** Do we trust `<link rel="canonical">` and `og:url`? They are often wrong or self-serving, and trusting them means the page decides its own key.
- **SPA navigation.** YouTube, Reddit, X, and most modern news sites never do a full page load. How does the extension detect a Subject change, debounce it, and avoid firing Lookups on transient intermediate states? What tears down and re-injects the pill?
- **Agreement across layers.** The client, the Discussion Index, and any Shared Digest must canonicalize *identically* or cache keys silently diverge. Where does that shared implementation live, given ticket 05's package graph, and how is it versioned when the rules change?

**The decision:** the canonicalization algorithm and the SPA navigation model, specified precisely enough to test.
