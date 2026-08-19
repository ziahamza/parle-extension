# The paste — every field, in console order

Everything the Developer Dashboard needs for **Parle 3.1.0**, in one file, in the order the console
asks for it. Nothing here needs a build, a script, or another document open.

**Why this exists as a file rather than a procedure:** Chrome Web Store API v2 has no method for
any field below — not the description, the summary, the screenshots, the tiles, the category, the
URLs or the privacy answers. `store/LISTING.md` sets out why, and why that is not going to change.
The package ships itself; this is the half that cannot.

**Open:** <https://chrome.google.com/u/2/webstore/devconsole> → the Parle item
(`bbigpojahnmkdbdnbcmadnhbjlemibom`).

---

## 1. Store listing tab

### Item name

```
Parle
```

Byte-identical to the manifest's `name`, and it has to stay that way — a listing title that
differs from the package is a rejection ground under misrepresentation.

### Summary — 123 of 132 characters

Paste from **[`store/summary.txt`](./summary.txt)**, or copy this:

```
See the Hacker News and Reddit discussions of the page you are reading. Finding them sends those sites that page's address.
```

### Description — 5,582 of 16,000 characters

Paste the whole of **[`store/description.txt`](./description.txt)**. Select all, copy, paste.

The store renders it as **plain text**, so the capitalised headings and hyphen bullets are
deliberate rather than un-rendered Markdown. Its second section (`WHAT IT SENDS, AND TO WHOM`) and
third (`THREE THINGS PARLE WILL NOT CLAIM`) are load-bearing for Chrome's Limited Use prominence
requirement — `store/check-listing.ts` fails if either goes missing.

### Category

```
Social Networking
```

Runner-up if the list differs: **News & Weather**. Do **not** pick *Privacy & Security* — this
extension transmits browsing addresses, and filing it under a privacy category invites exactly the
comparison it loses.

### Language

```
English (United States)
```

### Screenshots — all five, 1280×800, in filename order

From **[`store/screenshots/`](./screenshots)**. Upload in this order; the carousel follows it.

| # | File | What it shows |
|---|---|---|
| 1 | `01-the-discussions-beside-the-article.png` | The in-page dock over a real Wikipedia article — live Hacker News comments, the article still readable underneath. |
| 2 | `02-what-parle-sends-before-anything-is-looked-up.png` | **The disclosure.** The first-run screen with the question unanswered. Second in the carousel is where a reviewer meets it without scrolling — do not move it. |
| 3 | `03-the-mark-and-its-count.png` | The mark and its count, top-right of the page. |
| 4 | `04-where-parle-asked-and-what-each-answered.png` | The toolbar surface: found, refused, and not asked at all. |
| 5 | `05-the-most-discussed-thread-open.png` | The busiest thread open in the panel, comments being read beside the article. |

All five are regenerated from the real extension in a real Chrome by
`pnpm --filter @parle/extension e2e:store`, and audited for size and colour type by
`store/check-release.ts`.

### Icon and promotional tiles

| Slot | File |
|---|---|
| Store icon 128×128 | [`store/icons/128.png`](./icons/128.png) |
| Small tile 440×280 | [`store/small-promo-tile-440x280.png`](./small-promo-tile-440x280.png) |
| Marquee tile 1400×560 | [`store/marquee-promo-tile-1400x560.png`](./marquee-promo-tile-1400x560.png) |

The tiles are optional. **Delete the 2015 ones if they are still there** — they read "INTRODUCING —
A NEW WAY TO BROWSE THE WEB" and describe a product that no longer exists, which is a
misrepresentation risk on a listing under review.

### URLs

| Field | Value |
|---|---|
| Homepage / Official URL | `https://ziahamza.com/parle` |
| Support URL | `https://ziahamza.com/parle/support` |
| Privacy policy URL | `https://ziahamza.com/parle/privacy` |

**Clear `parle.co` if it is still in the Official URL field.** That domain is lost, and pointing a
listing at a domain you do not control cannot be verified.

All three are fetched anonymously — the state a logged-out reviewer sees — by
`store/check-listing.ts`, which runs on a schedule via `release-readiness.yml`.

---

## 2. Privacy tab

The long-form answers, the single-purpose statement and the five permission justifications are in
**[`store/listing.md`](./listing.md) §2 and §3**. They change far less often than the description
does, which is why they are not duplicated here — one copy cannot drift from itself.

The two things most likely to be stale on the live tab, both worth checking against 3.1.0:

- **`sidePanel` is no longer requested.** 3.1.0 removed the browser side panel (ADR 0021). If the
  live Privacy tab still justifies `sidePanel`, delete that justification — a permission justified
  but not requested describes a different extension. The shipped set is exactly `tabs`,
  `scripting`, `webNavigation`, plus host permissions `http://*/*` and `https://*/*`, asserted
  against [`store/listing.json`](./listing.json) by `store/check-release.ts`.
- **Website content.** Comments are fetched when the reader opens a Discussion, because the
  comments are what the panel shows — *not* only on the summarise click. `listing.md` §3.1 has the
  current sentence.

---

## 3. After saving

A listing-only edit still goes through review. The package and the listing are reviewed
separately, so a listing edit does not resubmit the zip and a zip submission does not re-check the
listing — which is exactly why the two can drift apart and why this file exists.

`pnpm store:status` reports what the store is holding at any moment, published and pending.
