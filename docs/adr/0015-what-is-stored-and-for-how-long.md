# What the reader's machine stores, for how long, and how it is cleared

Three storage decisions, taken together because they interact.

## 1. A Silence is cacheable; a Refusal, a Garble and a Withholding are not

A **Silence** — a Network answered and had nothing — is the only Lookup outcome that is evidence about the world rather than about us, so it is the only one it is ever safe to keep. Its TTL is **derived from the Subject's own age**: minutes for a page published today, days for one from 2019. A twenty-minute-old post that had nothing at 09:00 can be on the Hacker News front page by 09:38; a 2019 post that had nothing at 09:00 will still have nothing at 10:15. A single fixed TTL is wrong in both directions at once.

A **Refusal** is a fact about the attempt, never about the Subject, and is never cached. A **Garble** is never cached and never retried.

A **Withholding is never stored at all** — it is recomputed on read from current Coverage. This clause is small and load-bearing. A stored Withholding, or a Silence trusted for too long, silently re-derives the X gate's decision: the gate reads "no Linked Mention", closes, and stays closed deterministically. Recomputing costs nothing and removes the failure entirely.

## 2. Mentions may be re-keyed when Aliases merge, but only on evidence we observed

A Mention keys on an **alias set that can grow**, so learning later that two addresses are one page repairs rows already stored. The alternative — immutable keys — silently orphans everything stored under a superseded address, which is a permanent and *undetectable* false-negative class on exactly the pages worth reading. A 640-point thread that becomes unfindable because the publisher changed a slug is the failure this project keeps choosing against.

A merge requires evidence **we observed**: a redirect the reader's own browser traversed, a Network's own submitted URL, or our own canonicalization rules. Never a page's self-declared `rel=canonical` — a page asserting its own identity is not evidence, and trusting it would let a publisher merge or split Subjects at will.

The cost is real and should not be understated: "the key" stops being a value and becomes a claim the world can revise, which complicates both the Local Discussion Cache and the index-key contract.

## 3. Two stores, one prominent clear, one finer control — and opaque keys

The **Local Discussion Cache** and the **Lookup Record** stay separate because their privacy properties are opposite: the first is built from pages the reader already loaded and discloses nothing extra, while the second is a dated record of URLs they visited, which [ADR 0001](./0001-x-access-via-user-session.md)'s once-per-TTL rule makes mandatory.

The reader gets **one prominent "forget everything"**, plus a finer control for the Lookup Record alone. This amends [ADR 0012](./0012-local-discussion-cache-built-from-browsing.md), which specified "a visible, single action" when there was only one store.

**The Lookup Record's keys are opaque** — a per-install salted hash. That store only ever needs to *recognise* a URL, never read one back, so nothing is lost, and the residue on disk becomes unreadable to anyone who obtains it. This is the cheapest privacy improvement available anywhere in the design.

## Consequences

- Subject age must be known to set a Silence's TTL, and it is not always available. Absent a publication date, fall back to the most conservative (shortest) TTL rather than the most convenient.
- Re-keying means the cache needs a merge operation that is safe to run concurrently with reads, and the index-key contract must tolerate a Subject URL that changes for a page whose content did not.
- Clearing the Local Discussion Cache throws away harvested work that is expensive to rebuild and was never a privacy liability. The finer control exists so a reader worried about the Lookup Record is not forced to pay that cost.
