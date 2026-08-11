# What is on the Exclusion List, where does it come from, and who can change it?

Type: grilling
Status: claimed

## Question

[ADR 0005](../../../docs/adr/0005-offline-prefilter-before-any-network-lookup.md) makes "look up every page except the Exclusion List" the default. That list is therefore **the entire privacy story of the MVP**, and it is protection by enumeration — it fails on whatever nobody thought of.

- **Categories and sources.** Private and non-web addresses (`localhost`, private IP ranges, non-`http(s)`, internal hostnames) are mechanical. The rest are not: banking, health, mail, calendar, documents, internal tools, plus destinations where a Lookup is pointless (search engines, social feeds, Facebook). Do we hand-curate, use an existing categorised domain list, or both? What is the licence on anything we adopt, given [ADR 0010](../../../docs/adr/0010-agpl-3.0-throughout.md)?
- **Beyond domains.** URLs carrying credentials or opaque tokens must be excluded regardless of host. What pattern actually catches those without excluding half the web?
- **Authenticated pages generally.** Is "the page looks logged-in" a signal we can use cheaply and reliably? It would catch a great deal the domain list never will.
- **User control.** Per-site pause is committed to. Can the reader add their own exclusions? See the current list? Is there an allow-anyway for a site they've excluded?
- **Updating.** [ADR 0005](../../../docs/adr/0005-offline-prefilter-before-any-network-lookup.md) says the list ships in the extension and is updatable from the static artifacts. But [ADR 0011](../../../docs/adr/0011-the-client-is-autonomous-the-backend-is-an-accelerator.md) forbids depending on the backend — so the bundled list must be complete enough to stand alone, and updates are pure improvement. How do we keep those in sync across releases?
- **Honesty.** What claim do we actually make in the README, store listing, and first-run screen? It cannot be "your browsing is private."

**The decision:** the list's contents, sourcing, update mechanism, user controls, and the exact public claim it supports.

## Answer

Researched, not yet ratified — findings in [research/ticket-03.md](../research/ticket-03.md). Headline: ship **four layers, not one list** (mechanical rules complete by construction; a separately-licensed domain artifact from UT1/CISA/Blocklist Project/Wikidata capped by Majestic; URL-shape rules; `noindex` as a hard exclusion), plus a user-editable list, a visible "excluded" state, and a manual-mode switch.

The finding that reframes it: the empirical line between extensions **criticised** and extensions **removed** is full-URL versus hostname. WOT, Stylish and Avast sent full URLs and were pulled (Avast drawing an FTC order and $16.5M); NewsGuard sends hostname only and survived. Parle is on the wrong side of that line by design, and no list curation moves it — which makes prominent in-UI disclosure the load-bearing mitigation, not a compliance chore. Chrome Web Store Limited Use enforcement began 2026-08-01 and names the product's user interface explicitly.

Three claims we may NOT make: "your browsing is private"; "we exclude URLs carrying credentials" (demonstrated recall is ~⅔ of the shapes we thought to test, and short share-tokens are undetectable in principle); "we protect sensitive categories" (the best available list is missing proton.me, tuta.com, icloud.com, coinbase.com, monzo.com, schwab.com, bsky.app — the exact domains reviewers test).
