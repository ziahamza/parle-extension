# Research: ticket 09 — Is it called Parle?

## Answer

**Recommendation: rename. Do it now, before the first store submission.** The strongest candidate is **Earshot**; the strongest *clean-namespace* candidates are **Aforesaid** and **Elsesaid**. Nothing found in this round argues for keeping "Parle," and the single most decisive fact was one the first pass missed entirely: **"Parlé" is already a shipping product name in this project's own space.**

The repo is currently `/home/hzia/repos/parle` and no artifact has shipped. The cost of renaming today is a find-and-replace plus a domain purchase. The cost of renaming after App Store Connect and Chrome Web Store listings exist is an entirely different order.

---

### 1. What changed from the first pass (corrections — do not cite the superseded versions)

Two load-bearing findings were **refuted** on independent verification and are corrected here. Both corrections make the case against "Parle" stronger, not weaker.

**Corrected — the domain picture.** The original claim ("every mainstream `parle.*` is registered; only `parle.so` and `parle.to` appear free") was wrong in both directions, because it treated failed whois lookups as proof of absence and read registry terms-of-use boilerplate containing the word "available" as an availability signal. Verified 2026‑08‑08 against per-TLD RDAP endpoints resolved through the IANA bootstrap file (<https://data.iana.org/rdap/dns.json>), not the `rdap.org` proxy:

- `parle.to` is **registered**, not free — <https://rdap.tonicregistry.to/rdap/domain/parle.to> returns a full domain object, registered 2025‑08‑24 via Spaceship Inc., expiring 2026‑08‑24, and `https://parle.to/` currently redirects to <https://rainn.works/> ("RainnWorks — AI-First Software & Developer Tools"). The earlier "no record" was a DNS failure: `whois.tonic.to` does not resolve.
- Conversely, **many** `parle.*` TLDs *are* free — `.site`, `.tech`, `.online` (Radix whois says verbatim "Domain parle.site is available for registration"), `.tv`, `.club`, `.news`, `.page`, `.so`. So domain scarcity is *not* a reason to leave the name, and was never the real problem.
- `parle.io` is **not** the French-learning app's domain. It sits on `ns5/ns6.afternic.com` and serves a 114-byte for-sale lander byte-identical to `parle.xyz`'s. The attribution was unsupported.

**Corrected — and this is the finding that decides the ticket.** The `parle.dev` / `parle.sh` pair registered on the same day was filed as an open question. It isn't one. Verified today: `https://parle.sh/` returns HTTP 200 with `<title>Parlé | Neutral ground for AI agents.</title>` and body copy *"Parlé is where AI agents talk to AI agents: moderated rooms for your agents to work with everyone else's… Request early access,"* with Docs / Pricing / Install navigation. `parle.dev` shares the identical Cloudflare nameserver pair and the **same registration minute** (2026‑05‑29T18:46:15, per <https://pubapi.registry.google/rdap/domain/parle.dev>) — one owner, two-domain brand. Two further live "parlé" products exist: `https://parle.chat/` → `<title>parlé — A private space for heartbreak</title>` (verified today) and `https://parle.cc/` → 302 to `https://parle.floot.app/` (verified today).

So there are **at least three shipping products already branded Parlé**, one of them a developer-tools/AI product with pricing and install docs. That is a live discoverability and trademark-adjacency problem in the exact market segment this extension occupies.

**Corrected — the App Store claim.** "There is an actively maintained iOS app literally named Parle" was refuted *as evidenced*. The cited app, trackId 6447072574 (`io.parle.app`, seller German Zvezdin), has App Store Name **"Parle: Learn French & Speak"** — 27 characters, inside Apple's cap of *"An app name can be up to 30 characters long"* (<https://developer.apple.com/app-store/product-page/>), so that whole string is the Name field. Apple reserves exact strings per localization, not word tokens: *"You can use an app name for one app per localization… If another developer is using the app name and you have trademark rights to it, you can submit a claim"* (<https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app>). That app therefore does **not** block "Parle."

A *different* app does hold the exact string, and I re-verified it myself today: trackId **6755752218**, bundleId `com.appios.parle`, seller GHIZLANE DAOUDI, Social Networking, v1.3.1, last updated 2026‑07‑30, 0 ratings. `https://apps.apple.com/gb/app/parle/id6755752218` → HTTP 200; `https://apps.apple.com/us/app/parle/id6755752218` → **HTTP 404**, and `itunes.apple.com/lookup?id=6755752218&country=us` returns `resultCount: 0`. It is live in GB/FR/DE/ES/IT/NL and absent from the US storefront. Neither app is a browser extension, so this is a name-reservation and search-discovery problem, not a category collision.

---

### 2. The case against "Parle," in priority order

**a) Three live products already use it in adjacent software space.** See above. `parle.sh`/`parle.dev` ("Parlé — Neutral ground for AI agents") is a dev-tools brand with an install flow. This alone would be enough.

**b) Parler adjacency — the reason to care most.** "Parler" is the French infinitive; "parle" is its third-person singular. Same word, one inflection apart, chosen for the same reason. Parler is not dormant: iOS bundle `com.parler.parler` (Sovren Technologies) updated 2026‑07‑29 and surfaced as the #2 result in the same App Store query that found "Parle" (<https://apps.apple.com/us/app/parler/id1402727988>); Sovren announced the Sovren Network in June 2026 (<https://www.globenewswire.com/news-release/2026/06/04/3307040/0/en/parler-s-parent-company-sovren-technologies-unveils-the-sovren-network-engineered-for-the-new-era-of-digital-asset-regulation.html>). This matters because the closest prior product in this exact category — a browser extension attaching commentary to arbitrary URLs — was Gab's **Dissenter**, removed from both the Chrome Web Store and Firefox AMO over hate-speech policy (<https://www.cjr.org/analysis/dissenter-plugin.php>, <https://reclaimthenet.org/google-chrome-web-store-bans-dissenter-extension>). A Parler-shaped name makes *"is this Dissenter again?"* the default reading for a store reviewer, rather than a stretch. That is an unforced error on a product whose whole posture (ADR 0006) is that it reports and does not adjudicate.

**c) Search is unwinnable.** Parle Products (India) is a ~$2.2B company; Parle‑G is reported as the world's best-selling biscuit, ~70% of India's glucose-biscuit category. It holds live US registrations: PARLE‑G serial 76454475 (IC 030) and PARLE serials 85057045 / 85057060 (IC 030, "BISCUITS AND WHEAT FLOUR"), all LIVE/REGISTERED to Parle Products Private Limited (<https://tmsearch.uspto.gov/>, <https://www.parleproducts.com/>). Add "parle" as one of the most common inflected forms in French. Page one of any search for the name will never be this product.

**d) Trademark exposure in Class 9 — where a browser extension actually sits.**
- **PARLÉ, US Reg. 6580811** (serial 90477059), Biamp Systems LLC, **standard character claim: Yes**, IC 009, LIVE/REGISTERED, with Madrid International Registration 1577766A. Standard-character protection covers the word in any font, and an acute accent is unlikely to distinguish. Goods are conferencing microphones, so coexistence is plausible — but this is a well-lawyered, internationally extended, live Class 9 registration on the literal word. **Caveat: I could not independently re-fetch <https://tsdr.uspto.gov/statusview/sn90477059> today (HTTP 403 to non-browser clients); this rests on the earlier read and needs a human confirmation.**
- **PARLE, serial 99742756**, AutoRenu JV LLC, filed 2026‑04‑03, LIVE/APPLICATION/Awaiting Examination, IC 009 (downloadable mobile application software) + IC 039. Mitigating: design mark, not standard character, and the goods are ride-hail dispatch. This one was independently **confirmed** in the earlier round; TSDR also returned 403 to me today.

**e) It is not spellable from hearing.** English gives at least `/pɑːl/`, `/pɑːrˈleɪ/` (parlay), `/ˈpɑːrleɪ/` (parley). Direct evidence this is a known problem: the AutoRenu filing writes the pronunciation into the mark description itself — *"The characters 'PARLE (/par.lay/)' are a unique variation of the French word parler, meaning 'to speak'"* (serial 99742756). A filer felt obliged to gloss it in a legal document. Merriam-Webster does list "parle" as an English verb meaning "parley," first use 14th century (<https://www.merriam-webster.com/dictionary/parle>) — apt, but archaic and invisible to a modern audience.

**f) Namespaces.** `npm parle` is **taken** — re-verified today: `GET https://registry.npmjs.org/parle` → HTTP 200 (control `zzqqxx9nothing` → 404), metadata `name: "parle"`, "Clojure nrepl command line client", EPL‑1.0, John Kane, three versions from August 2015. Dormant enough that a dispute is arguable (<https://docs.npmjs.com/policies/disputes>) but not assured. `parle.com` is a live unrelated business (Parle Enterprises Inc, promotional-products e-commerce; registered 1995‑12‑01, expiry 2029‑11‑30, all four `client*Prohibited` statuses — it is not coming loose). GitHub `parle` is a zero-repo squatter account from 2013.

**The one axis where "Parle" is clear:** no Chrome extension named Parle surfaced. `https://chromewebstore.google.com/search/parle` (HTTP 200, 540KB) returned only speech/transcription/pronunciation tools. This establishes "none surfaced," not "none exists" — CWS search is fuzzy and the payload is a scraped SPA.

---

### 3. Ranked shortlist

Availability re-verified 2026‑08‑08 against authoritative registry RDAP (IANA bootstrap) and `registry.npmjs.org`, with 404 controls. **GitHub could not be checked this round** — `api.github.com` returned 403 (rate limit) for every handle probed. Treat GitHub as a non-signal regardless: every plain-English word tested in the earlier round (`earshot`, `backchannel`, `overheard`, `hearsay`, `chorus`, `gloss`, `verso`…) was already taken by dormant accounts; only coined compounds came back free.

**1. EARSHOT — recommended.** *"Within earshot of what's being said about this page"* is the product in three words. Plain English, two syllables, one spelling, one pronunciation, no political adjacency, and it makes no truth claim — so it satisfies ADR 0006, which forbids the product from ever marking something contested from its own knowledge.
- `npm earshot` → **404, free** (verified today).
- USPTO IC 009 — the class the extension files in — is **clear**: every EARSHOT mark in Class 9 is DEAD (75543587, 76401098, 79212632, 78617432, 85951625, 85954303).
- One live obstacle, which I **re-verified in full today** at <https://tsdr.uspto.gov/statusview/sn99685839>: serial 99685839, EARSHOT, **standard character**, **IC 042 only**, intent-to-use, owner **Amid LLC** (8605 Santa Monica Blvd, West Hollywood), filed 2026‑03‑05, **PUBLISHED FOR OPPOSITION 2026‑07‑21**, for *"Software as a service (SAAS) services featuring software for tracking and optimizing brand and product visibility in artificial intelligence generated search results."* Different class, different customer, different job — but same broad software space, and it is ITU so no use has been shown yet.
- Domains, verified today: `earshot.com` and `earshot.app` sit on `ns1/ns2.afternic.com` serving for-sale landers — i.e. **registered but brokered and purchasable at a price**. `earshot.dev` is on Vercel DNS with an empty title, and `getearshot.com` (reg. 2025‑04‑04) and `tryearshot.com` (reg. 2026‑06‑01) are taken — consistent with the Amid LLC team, so those three are effectively off the table. **`earshot.so`, `earshot.sh`, and `earshot.wiki` are unregistered** (`whois.nic.so`: "The queried object does not exist: No Object Found"; Identity Digital whois for `.sh`: "Domain not found."; `rdap.nic.wiki` → 404; no NS delegation for any of the three).

**2. AFORESAID — recommended if a fully clean namespace outweighs resonance.** "What was said before" is literally the product. Register is slightly legal/stiff, but it is unambiguously spellable and clearly unclaimed. Verified today: `npm aforesaid` → 404 free; `aforesaid.app` and `aforesaid.dev` → RDAP 404, no delegation, **free**. `.com` taken.

**3. ELSESAID.** Coined, reads as "what else was said," short, spellable, and distinctive enough to be a strong mark — coined terms are the easiest to protect. Verified today: `npm elsesaid` → 404 free; `elsesaid.app`, `elsesaid.dev` → RDAP 404, **free**. `.com` taken.

**4. PRIORCHAT / WASITSAID.** The only names measured free on every axis at once (`npm` 404 and `.com` RDAP 404, both re-verified today). Both are weak as marks — descriptive names get thin protection — and "chat" wrongly implies the user can post, which this product does not allow. Fallbacks only.

**Rejected on meaning or collision, not availability:** BACKCHANNEL and OVERHEARD are semantically better than everything above and carry no political charge, but nothing is available under either on any axis probed. MARGINALIA collides with `marginalia.nu`, a known independent search engine in the adjacent alternative-discovery niche. OVERTALK inverts the posture ("to overtalk" is to interrupt). OFFPAGE drags in "off-page SEO." CROSSTALK is RT's political talk show; VERSO is Verso Books — both re-import politics through the side door, which is what this rename exists to prevent. HEARSAY connotes inadmissible/unreliable and collides with Hearsay Systems. CHORUS means voices in unison, the opposite of showing disagreement, and collides with ZoomInfo Chorus. PALAVER is the same etymological family as Parle.

**Rule out categorically before any future round:** anything implying adjudication of truth — Verify, Verity, Fact*, Check*, Corroborate, Vetted, Debunk, Litmus, Arbiter, Verdict, Truth* — because ADR 0006 states the Digest *"may report 'this is disputed here'; it may never mark something contested from the model's own knowledge"* and rejects full verdicts *"because it makes us the arbiter, with the liability and trust cliff that follows."* A name is a promise the product then has to keep. Also rule out anything `Ground*`-shaped: ADR 0006 names "Outlet bias ratings (Ground News-style)" as out of scope and ADR 0009 is explicitly "audience spread, not outlet ratings," so a Ground-echoing name would advertise the feature the project deliberately declined. And rule out the whole Parler / Dissenter / Gab / Gettr / Rumble / Community Notes neighbourhood — including a bare "Notes," which reads as a Community Notes clone and conflicts with ADR 0006's rule that Community Notes are surfaced verbatim as *other people's* verdicts, never as ours.

---

### 4. What I could not establish

- **This is not a trademark clearance opinion.** Wordmarks only — no phonetic equivalents, no design marks, no common-law use search. Whichever name is chosen, counsel should clear it before store submission.
- **No non-US register was searched.** TMview/EUIPO were unreachable from this environment and Justia/Trademarkia/uspto.report are Cloudflare-blocked. Given that Parle Products is Indian, an **IPO-India Class 9/42** search was specifically warranted and did not happen. Also unchecked: which territories and classes Biamp's Madrid registration 1577766A designates, which determines non-US exposure.
- **TSDR returned 403 to me today** for serials 90477059 (Biamp) and 99742756 (AutoRenu). Those two rest on the earlier round's reads; 99742756 was independently confirmed then, 90477059 was not. Re-check both.
- **Whether "Parle" or any alternative is registrable in App Store Connect for en‑US.** Apple reserves names per localization and keeps unreleased reservations invisible from outside; the US-storefront absence of `com.appios.parle` does **not** imply its record lacks an en‑US reservation. Only an attempt inside a real App Store Connect account settles this.
- **Chrome Web Store cannot prove a negative.** Only the store's own name-conflict check at submission time is definitive.
- **X/Twitter handles.** `curl -I` on x.com is unreliable (SPA shell returns 200 for anything) and the old syndication endpoint now returns empty. Verifiable adjacent data point: `parle.bsky.social` and `parley.bsky.social` both resolve to DIDs (taken); `mastodon.social/@parle` → 404, `@parley` → 200.
- **npm *organisation* scope `@parle`.** `npmjs.com/org/parle` and `/~parle` return 403 to non-browser clients and the registry API exposes packages, not orgs. `@parle/core` returning 404 proves only that one package does not exist.
- **GitHub handles for the shortlist.** API rate-limited to 403 this round; re-check, but expect every real word to be taken.

---

### 5. Concrete next steps for a human

1. **Decide Earshot vs. Aforesaid/Elsesaid.** The trade is resonance versus a clean namespace. Earshot is the better name and its Class 9 is clear; Aforesaid/Elsesaid are the safer namespace with a duller name.
2. **If Earshot: watch serial 99685839.** The opposition window opened 2026‑07‑21. Its outcome materially changes the clearance picture and resolves within months. Meanwhile get a price on `earshot.com` via Afternic (it is brokered, not dead) and register `earshot.so` / `earshot.sh` today as the cheap fallback — all three verified unregistered above.
3. **Order a real clearance search from counsel** for the chosen name, covering US + EU + India, phonetic equivalents and design marks, in Classes 9 and 42.
4. **Test the exact name string in App Store Connect** before committing. That is the only way to learn whether the en‑US localization is reserved.
5. **Only then** rename the repo, the package, and the ADR references.

**Do not spend legal-review budget on this ticket at the expense of ticket 03.** Nothing in this analysis touches the Exclusion List or AGPL‑3.0 redistributability, which is where a wrong answer becomes a legal problem rather than a marketing one.
