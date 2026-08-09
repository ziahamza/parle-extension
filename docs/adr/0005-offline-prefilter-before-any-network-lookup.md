# Look everything up by default, minus an Exclusion List; the prefilter becomes a gate only once it is exhaustive

Finding Discussions requires sending the Subject URL in plaintext to third-party Networks — hashing cannot help, because search needs the literal URL. The default behaviour is therefore: **look up every page, except those matching an Exclusion List.** The Discussion Index (a bloom filter of URLs known to have Discussions) is built and shipped as an optimisation for speed and request volume — but it **does not gate Lookups** until it is exhaustive across every Network we support.

## Why not gate on a partial prefilter

A prefilter that is incomplete produces **silent false negatives**. A Lookup that never fires is invisible: the reader never learns a Discussion existed, and has no signal that anything was withheld. A disclosed URL, by contrast, is a known and boundable cost. Trading a visible cost for an invisible one degrades the product in the one dimension that cannot be measured or complained about.

The experience this protects is concrete: a reader who arrives on a page **must see its Discussions immediately**, without clicking. Any mechanism that makes the common case "nothing appeared, try clicking" defeats the product.

## The Exclusion List

An exhaustive-as-possible list of places where a Lookup is either meaningless or unwelcome, shipped in the extension and updatable from the static artifacts:

- Non-public and non-web: `localhost`, private IP ranges, non-`http(s)` schemes, internal hostnames
- Anything carrying credentials or opaque tokens in the URL
- Sensitive categories: banking, health, mail, calendar, documents, internal tools
- Walled or self-referential destinations where search returns nothing useful: search engines, social feeds, Facebook, and similar

The list is protection by enumeration, which fails on whatever is not enumerated. This is understood and accepted for now, and it is the reason the honest public claim is **"we exclude these"**, not "we guarantee your browsing is private". The claim strengthens when the prefilter becomes the gate.

## Free cases that need no Lookup at all

When the reader **arrives from a Network** — clicks a link on Hacker News or Reddit — the referrer already identifies the Discussion. That case is answered instantly, with no Lookup, no index, and no backend. It should be implemented explicitly rather than falling out of the general path, because it is both the cheapest and one of the most common ways a reader encounters a discussed page.

## Click-to-check is always available

Regardless of automatic behaviour, opening the extension on any page always performs a Lookup. The toolbar action never says "not applicable" — it is the reliable manual path, including on excluded pages where the reader deliberately asks.

## Consequences

- **Request volume is proportional to browsing, not to discussion.** Every non-excluded page produces Lookups against every Network. Caching, deduplication, and pacing carry the whole load, and are load-bearing rather than optimisations.
- X is exempted from "look everything up": it is **gated at runtime** on Hacker News or Reddit having already returned a Discussion, since without an index there is otherwise nothing bounding authenticated requests against a user's own X account. See [ADR 0001](./0001-x-access-via-user-session.md).
- The Discussion Index is now a **backend-track optimisation**, not an MVP prerequisite. Seed-index sizing, sharding, and delta format all move off the MVP critical path.
- Promotion of the prefilter from optimisation to gate is an explicit future decision with a bar attached: exhaustive coverage across HN, Reddit, and X. Partial coverage does not qualify, and shipping it as a gate early is the failure mode this ADR exists to prevent.
- Store listings, the privacy manifest, and first-run disclosure must describe the actual behaviour — every page you visit, minus an exclusion list, is sent to third-party Networks. This is the single most scrutinised claim in the submission.
