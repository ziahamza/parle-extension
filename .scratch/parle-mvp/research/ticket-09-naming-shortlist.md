# Research: ticket 09 — naming shortlist

# Naming Recommendation — final

## 1. The recommendation

**Elsewire.** Buy **elsewire.io** today, plus **elsewire.dev** and **elsewire.ai** defensively (all three re-verified free by RDAP on 2026-08-08).

It is the only candidate that all three judges placed in their top three, and the only one whose meaning lands *correctly* on first hearing: "else" + "wire" parses instantly as the wire feed from elsewhere, and a wire service is the English language's canonical example of an institution that transmits and never rules — ADR 0006 stated in a morpheme a Chrome reviewer already understands. Registry position is genuinely clean rather than technically unblocked: .io, .ai, .dev free, npm free, GitHub free, zero US trademark records, nothing in either app store, nothing on the Chrome Web Store, and no real-world brand of any size occupying the word.

---

## 2. Runners-up

**Elsecast** — the widest-open registry position in the entire set (six of seven TLDs free, including .app, which Elsewire loses). *Lost because* "-cast" mis-signals the category: the first read is podcast or screen-mirroring, and this product returns text threads. That is a comprehension failure on first hearing, which is the exact class of problem the rename exists to fix — Elsewire is spellable *and* correctly understood; Elsecast is only spellable. The suffix is also the most farmed in consumer software, so an examiner will treat it as weak.

**Earful** — the most likeable name on the board and the best icon idea in the set (an ear is unmistakable at 16px); the idiom means "what people think," never "what is so," which is the posture exactly. *Lost on availability and legal exposure*, which is the owner's stated deciding criterion: only .dev and .so are free (.com, .io, .ai, .app all gone), the GitHub org is taken by a 2-repo account, and "Earful: AI for Podcasts" (GH Innovation, Inc.) ships in the US App Store — the single most likely holder of a live Class 9 mark anywhere in this set, and the trademark is entirely unmeasured.

**Talkpage** — the safest name at store review (Wikipedia vocabulary is the antithesis of Parler/Gab/Dissenter), the best-measured trademark result of anything here (zero USPTO records in any class, queried against the real Elasticsearch backend), and .io free. *Lost because* zero trademark records is a symptom, not a win: the name is descriptive-generic, so it is hard to register, hard to defend, and permanently outranked by Wikipedia's own documentation for its own query. "Talk2Page" already exists as an adjacent extension.

---

## 3. Evidence table (top five)

| Name | Best free domain (proof) | npm | GitHub | Store collisions | Trademark |
|---|---|---|---|---|---|
| **Elsewire** | **.io free** — `https://rdap.identitydigital.services/rdap/domain/elsewire.io` → **404**; also `.ai` → 404, `.dev` (`pubapi.registry.google`) → 404, `.so` → 404, `.co` whois `DOMAIN NOT FOUND`. Taken: `.com` → 200 (Hostinger-parked, exp 2026-12-14), `.app` → 200 (same parker, exp 2026-12-19). Controls: google.io 200 / zzqqxx9nothingxyz.io 404; google.dev 200 / nonsense.dev 404 | **FREE** — `registry.npmjs.org/elsewire` → 404 | **FREE** — `github.com/elsewire` → 404 | **None.** CWS: 473,150 B = empty baseline (fuzzy-search caveat: "none surfaced," not "none exists"). iTunes US resultCount=12, GB=10, no exact trackName | **No US records** — TMview `tmdn.org/tmview/api/search/results`, territories=[US] → 200, 0 records. **USPTO direct UNVERIFIED** (tsdr 403, tmsearch 405) |
| **Elsecast** | **.io free** — `https://rdap.identitydigital.services/rdap/domain/elsecast.io` → **404**; also `.app` → 404, `.ai` → 404, `.dev` → 404, `.so` → 404, `.co` whois `DOMAIN NOT FOUND`. Taken: `.com` → 200 (Porkbun parked lander) | **FREE** — → 404 | **FREE** — `github.com/elsecast` → 404 | **None.** CWS on empty baseline; iTunes US/GB resultCount=20, no exact match | **No US records** — TMview → 200, 0 records. **USPTO direct UNVERIFIED** |
| **Earful** | **.dev free** — `https://pubapi.registry.google/rdap/domain/earful.dev` → **404**; `.so` → 404. Taken: `.com` (broker listing), `.io`, `.ai`, `.app` | **FREE** — → 404 | **TAKEN** — `github.com/earful` → 200; Org, 2 public repos since 2016. Near-dormant, but **not** the zero-repo squatter the bar allows | **One US iOS app**: "Earful: AI for Podcasts" (GH Innovation, Inc.). GB storefront: zero name matches. CWS: none surfaced | **UNVERIFIED** — no query completed. GH Innovation, Inc. is a plausible Class 9 holder |
| **Talkpage** | **.io free** — `https://rdap.identitydigital.services/rdap/domain/talkpage.io` → **404**; also `.dev`, `.app`, `.so`, `.co` free. Taken: `.com` (301s to inboxpage.com — in use), `.ai` | **FREE** — → 404 | **TAKEN** — `github.com/talkpage` → 200; 1 repo, created 2026-03-02, active. Misses the bar | **None exact.** Adjacent "Talk2Page" extension exists. iTunes US/GB: no exact match | **CLEAR (measured)** — `POST tmsearch.uspto.gov/prod-v1-0-0/tmsearch`, match_phrase wordmark "talkpage" → 200, totalValue=**0**, all classes. Controls: microsoft → 32 LIVE exact |
| **Thrum** | **.so only** — `rdap.nic.so/domain/thrum.so` → 404. `.com` is a live site; `.io`, `.ai`, `.dev`, `.app` all 200 | **TAKEN, ACTIVE** — → 200, latest **v5.0.0**, last publish 2025-12-23. Not disputable | **TAKEN, ACTIVE** — → 200; real developer, 13 repos | **Two exact-name iOS apps** in US *and* GB: "Thrum – Haptic Meditation", "Thrum: ADHD Focus Timer". CWS: completely clean | **UNVERIFIED** — no query completed. Two live apps make a human Class 9 search mandatory |

All 2026-08-08 re-checks ran with positive/negative controls in the same code path; every control discriminated correctly.

---

## 4. What a human must do before this is safe

**Trademark (blocking — do this first).** `tsdr.uspto.gov` returns 403/000 to non-browser clients and `tmsearch.uspto.gov` sits behind an AWS WAF, so nothing below was reachable from an agent. In a real browser, at `tmsearch.uspto.gov`, run a knockout search on **ELSEWIRE**, standard-character, **Nice Class 9 and Class 42**, live marks only. Repeat for **ELSECAST** as the fallback. TMview returned zero US records for both, but TMview mirrors USPTO with a lag and does not expose the standard-character flag — treat it as corroboration, not clearance. Budget one hour, or one counsel email.

**Domains (do today, before the trademark result — they are cheap and drop fast).**
- Register `elsewire.io` (primary), `elsewire.dev`, `elsewire.ai`.
- Register `elsewire.so` and `elsewire.co` if completeness matters; both measured free.
- **Backorder `elsewire.com` (expires 2026-12-14) and `elsewire.app` (expires 2026-12-19)** — same Hostinger-parked holder, no business behind either, four months out. Set a drop-catch now; a 2026-12 acquisition would upgrade the whole position. Do not pay a broker premium before the trademark clears.

**Handles (do today).**
- GitHub org `elsewire` — confirmed free 2026-08-08, claim immediately.
- npm `elsewire` — confirmed free, publish a placeholder to hold it.
- **X `@elsewire` is TAKEN** by "Elsewire Studios," a hobbyist account active since 2018 — no company, no mark, but you cannot have the matching handle. Claim `@elsewireapp` or `@getelsewire` and decide whether to attempt a purchase. This is the one permanent nick on the name and matters slightly more than usual for a product that surfaces X.
- Chrome Web Store and App Store name reservations: CWS search returned an empty-results payload, but that is fuzzy SPA search, not an API — a human should confirm at listing-creation time, where the store enforces uniqueness for real.

---

## 5. Eliminated late — do not re-propose

- **Thrum** — the best-*sounding* name in the set and a brand designer will bring it back. It fails three prongs of the bar as written: npm `thrum` is live at v5.0.0 (published 2025-12-23), two exact-name iOS apps ship in both US and GB storefronts, and the GitHub handle belongs to an active 13-repo developer. Only `.so` is free while `thrum.com` is a live site. Its one irreplaceable asset — a completely empty Chrome Web Store — does not offset a `.so`-only domain position against an owner who explicitly wants a common TLD.
- **Rotunda** — `rotunda.com` is not parked; it is a **live adult-content site held since 1993**. It will not lapse. For a store-reviewed consumer extension that users search by name, that is unfixable brand poison. Mechanically clears the bar; dropped on judgement.
- **Onlooker** — would have been a front-runner on the word alone. `onlooker.dev` is a **live shipping product**, "Onlooker — AI Development Observability," same word, in software, aimed at developers, holding `.dev` and `.app` on one Cloudflare account with Class 9 vacant to file into. Competing for your own name inside your own market.
- **Sidetalk** — fails constraint 6 outright. Sidetalk is a viral NYC street-interview brand with millions of followers, WME representation, a Wikipedia page and merch. Registry-clean, query-owned.
- **Hustings** — best availability in its batch (five free TLDs) and ruled out anyway. Hustings is electoral vocabulary; an election word on an extension that annotates arbitrary URLs hands a store reviewer the political frame for free. Availability cannot buy that back.
- **Bystander** — imports "bystander effect" and "bystander intervention training," i.e. anti-harassment and moderation vocabulary, which is the exact register ADR 0006 wants distance from; it also hands every critic a free cheap shot. Plus Bystander Inc. is a real incorporated US publisher shipping an iOS app, making a live Class 9 mark plausible and unmeasured.
- **Secondhand** — pre-labels its own output as hearsay, and every measured search surface (App Store US, App Store GB, CWS) returned thrift and resale results. Ten characters.
- **Obiter / Passim / Anent / Excursus** — intellectually the best posture fits, all rejected on the same ground: the meaning is invisible without a footnote, so they function as coined words carrying extra pronunciation risk. Obiter specifically reproduces the Parle failure (OH-bit-er vs OB-it-er, and it brushes "obituary"). Anent, Passim and Obiter are additionally `.so`-only or `.dev`-only.
- **Chinwag** — the warmest word in the set, but `chinwag.com` is a UK digital-media community running since 1996 with equity in precisely this product's professional audience, plus Chinwag Social is an existing Mastodon app. Not a legal blocker; a permanent recognition tax no registry check catches.
- **Crier** — the sharpest concept on the board (a crier carries the announcement and never authors it), but six of seven TLDs are gone and it becomes a four-to-five-figure acquisition, "Cryer" is a live alternate spelling, and the everyday sense is "one who weeps."
- **Aforesaid** — near-perfect availability, ungrammatical in the UI slot ("Aforesaid found 6 discussions"), nine characters, and it never becomes a name anyone says aloud.
