# Parle — Privacy Policy

**Last updated: 3 September 2026.** Applies to the Parle browser extension, Chrome Web Store item
`bbigpojahnmkdbdnbcmadnhbjlemibom`, and its Parle companion apps for Safari on macOS, iOS and
iPadOS.

This document is the privacy policy the Chrome Web Store listing points at. It is deliberately
the same set of facts the extension itself shows you on its first screen and on its settings
page. If the two ever disagree, the extension is what actually runs; tell us and we will fix
the document.

---

## The short version

- **There is no server of ours.** This project runs none. There is no account, no sign-up, no
  identifier, no analytics and no telemetry. The one thing the extension downloads from us is a
  daily static file — the skip-list update of §1.11, byte-identical for every install, served from
  the public code host and carrying nothing about you in either direction. We — the people who
  wrote Parle — receive nothing about you, ever, because there is nowhere for it to arrive.
- **But Parle is not private.** To find out whether anyone has discussed the page you are
  reading, it tells Hacker News, Reddit, Bluesky and Lemmy which page it is, and Lobsters which
  site it is on. Those services see it. This happens on most pages after you choose automatic lookups.
- **Everything Parle learns about pages stays on your machine.** Most of it is in your own browser
  profile. On Safari, opening Parle also puts a readable Recent list in a device-local container
  shared with the companion app: at most 100 pages for 30 days, with the original page, its
  archived copy and the Discussions Parle found. It does not sync. One button deletes it. Your
  settings, including a Provider key, remain until you change them or uninstall Parle.

---

## 1. What is sent off your machine, and to whom

### 1.1 Hacker News — `hn.algolia.com`

Sent: the address of the page you are reading, after canonicalization (up to four alias forms of
it). **Nothing else — not the page's title.** The title is used inside the extension to label
what you are reading and never leaves your machine.

Credentials: none. No cookies, no key, no account. The request is anonymous in the sense that it
carries no identity of yours — but the address itself is the content of the request, and the
service and its network path can see it.

### 1.2 Reddit — `www.reddit.com`, falling back to `old.reddit.com`

Sent: the same canonicalized address. As above, the title is not sent.

Credentials: **your own Reddit cookies are attached to the first attempt** (`credentials:
"include"`), because Reddit answers `403` to a cookie-free request from most addresses. This
means that if you are signed in to Reddit, the request that carries the address of the page you
are reading goes out as *you*, and it shares your account's rate limit. The fallback attempt is
cookie-free. Reddit can be switched off entirely on the settings page, in which case nothing is
sent to it and nothing Reddit previously supplied is shown.

### 1.3 Bluesky — `public.api.bsky.app`

Sent: the same canonicalized address, as a public post search. No title is sent. Results are kept
only when the address in the returned post matches one of the page's known addresses.

Credentials: none. No cookies, key or account. Bluesky can be switched off entirely on the
settings page.

### 1.4 Lemmy — `lemmy.world`

Sent: the same canonicalized address, in up to two exact-address searches. Parle asks this one
public instance because federation makes it a useful view of discussions across Lemmy; it does
not contact every instance. No title, cookie, key or account is sent. Lemmy can be switched off
entirely on the settings page.

### 1.5 Lobsters — `lobste.rs`

Sent: the page's registrable domain, to load one public domain listing. Parle then compares each
returned story's submitted address with the page's known addresses on your machine. No title,
cookie, key or account is sent. Lobsters can be switched off entirely on the settings page.

### 1.6 X

Nothing. The code that would contact X is compiled out of this build (`__PARLE_X__ = false`), so
the requests are not merely disabled, they are absent from the shipped file. You can verify this
in the package.

### 1.7 Link shorteners — `t.co`, `bit.ly` and similar

Only while you are already on Hacker News, Reddit, X, Bluesky, Lemmy or Lobsters, and only if you answered the first-run
question with "Look pages up automatically": Parle issues a `HEAD` (and one `GET` if that is
refused) for a shortened link **that was on the page you were already looking at**, to learn
where it points. Nothing about any other page you have read is involved. Capped at 150 requests
an hour, deduplicated per page, and cached. No credentials.

### 1.8 Archive and Wikipedia — only when you open Parle on a page

Opening Parle's panel sends the canonicalized address to `archive.org` to ask whether it has kept
a copy, and to `en.wikipedia.org` to ask whether any English Wikipedia article cites it. Neither
is asked merely because you opened or read a page, and each answer is held only in the current
in-memory Enquiry.

The Archive line is a single link to the kept copy. If you deliberately enable **Open the archived
copy instead of the page**, archive.org is instead asked as each non-skipped page opens and Parle
may take you to a recent kept copy. The setting is off by default and its disclosure appears
before the switch.

Credentials: none. No cookies, key or account.

The panel's publisher Standing is different: it is read from a static file bundled inside the
extension. Looking up a publisher there makes no runtime request and sends nothing anywhere.

### 1.9 Comment bodies — when you open a discussion, and when you ask for a Digest

Opening a discussion in the panel fetches that discussion's comments, because the comments are
what the panel shows. Pressing **Summarise these discussions** fetches the comments of the
discussions found for that page — at most six. Both read
`hn.algolia.com/api/v1/items/…` and `www.reddit.com/comments/….json`; Hacker News is asked with no
credentials, Reddit with your cookies, as in 1.2.

For a Hacker News discussion, one further request fetches that thread's page at
`news.ycombinator.com/item?id=…`, without credentials, so the panel can show the comments in the
order the thread itself shows them — no API carries that order. A summary ranks comments by
score; where the API reports no scores — Hacker News reports none for comments — that same order
decides between them, and if the page cannot be fetched the comments fall back to oldest-first.
Either way the request sends the thread's public id and nothing else; the address of the page you
are reading is never part of it.

Neither happens on a page load, and neither happens for a page whose panel you never opened.

### 1.10 Your AI Provider — only when you press that same button, and only if you connected one

If you have connected a Provider on the settings page, pressing that button sends **the page's
address and the text of the comments just fetched** to the endpoint you configured — your own
API key's endpoint, your pasted ChatGPT token's endpoint, or nowhere at all if you chose your
browser's built-in on-device model, in which case the text never leaves the machine.

This is the largest thing Parle ever sends anywhere, and it is the only thing that never happens
without a deliberate click. The panel states, before you click, how many discussions would be
read and where the text would go.

Whatever that Provider does with the text is governed by your agreement with them, not by this
policy.

### 1.11 The skip-list update — `raw.githubusercontent.com`

At most once a day, and never before you have answered the first-run question, Parle downloads
one small file: an update to the built-in skip list, published in the extension's own source
repository. The request is the same for every install and carries nothing about you or about any
page you visited — no cookies, no identifiers, no addresses. The update can only ever **add**
entries to the skip list (that is enforced in the extension's code, not promised by the server),
so this file can make Parle look up fewer pages, never more.

### 1.12 Us

Nothing else goes to infrastructure operated by this project. There is no backend. The file above
is a static download from a public code host; nothing about you travels with it.

---

## 2. What limits the sending

- **Nothing at all is sent until you answer the first-run question.** On install, Parle opens
  one screen naming where the address goes and asks whether it should look pages up
  automatically or only when you click the toolbar button. Until that question is answered, no
  address leaves your browser on any page, whatever else is configured — and pages you are
  already on are not harvested either.
- **Answering "Only when I ask"** means nothing about the pages you read is sent as you browse —
  the one request that still runs is §1.11's daily skip-list check, which carries no page and no
  identifier. The toolbar button still
  works on every page.
- **The skip list.** Parle does not look up pages matching a built-in list — updated by the
  add-only published file of §1.11 — banks, webmail,
  AI chats, health, government, adult sites, social feeds, private and internal addresses — nor
  addresses that visibly carry a token or credential. **This list is incomplete and will miss things**,
  including services nobody has told us about and short share links that look like ordinary
  addresses. See §6.
- **The fragment is always discarded.** Nothing after `#` in an address is ever sent. Tracking
  parameters are stripped before sending.
- **Only the tab you are looking at.** Background tabs, links opened to read later, and session
  restore produce no requests.
- **Top frame only.** Embedded videos and ad iframes never become a page Parle asks about.
- **Per-site pause**, your own additional exclusions, and per-site overrides, all from the
  settings page or the toolbar button.

---

## 3. What is stored, where, and for how long

Most things Parle itself stores are in your own browser profile, in a Cache store named `parle`.
Safari's companion list is the one exception: it uses the app's device-local shared container so
the macOS, iPhone or iPad app can show it. The third-party services named in §1 may keep their own
request logs under their own policies.

| What | Where | Notes |
|---|---|---|
| Your settings | `parle/settings/reader` | Includes **your AI Provider API key or token, as ordinary text**, if you connected one. See §4. |
| What Hacker News, Reddit, X, Bluesky, Lemmy and Lobsters showed you | `parle/recollection/…` | Links, thread identifiers, scores and comment counts read from those Network pages while you were already on them. Never leaves the machine. Bounded at 4,000 entries; oldest evicted first. |
| A record that a page was looked up | `parle/recollection/…` | Kept only so the same page is not asked about repeatedly. Its keys are **opaque** — a per-install salted hash — so the residue on disk is not readable back into a list of pages you visited. |
| The downloaded skip-list update | `parle/exclusions/update` | The file of §1.11 and the time it was fetched. Identical for every install; says nothing about you or your pages. |
| Safari Recent list | The Parle app's device-local shared container, partitioned by Safari profile | Written only after you explicitly open Parle on a page. Readable page title and canonical address, when you opened it, the original and archived-copy links, and the links, titles, scores and comment counts of every Discussion Parle found. At most 100 pages, automatically removed after 30 days. Never includes comments, Digest text, referrers or tab identifiers, and never syncs. |

No passive lookup writes a readable browsing history. The part of the code that harvests is given
a store that can write; the part that looks up is given one whose writes stay in memory and die
with the service worker. Safari makes one narrow, deliberate exception only when you open Parle:
it projects the fields named in the table above into the Recent list so the companion app can take
you back to the original page, its archived copy and all its Discussions. The schema has no field
for comments, Digest text, referrers, tab identifiers or page contents.

You can inspect the entire store yourself. Open the extension's service worker console and run:

```js
caches.open("parle").then(c => c.keys()).then(k => k.map(r => r.url))
```

**Deleting it.** The settings page has one prominent control that clears everything above except
your settings, including Safari Recents, and a finer control that clears only the opaque record of
what was looked up. The Safari companion app has its own **Clear Recents** control. Uninstalling
the browser extension removes its browser-profile data; use either clear control to remove the
shared Recent list.

---

## 4. Your AI Provider key is stored in the clear

If you connect a Provider using an API key or a pasted token, that credential is stored in the
settings entry above **as ordinary text**.

A Manifest V3 browser extension has no keychain and no secure element available to it; there is
nothing better to put a key in than the same store every other setting goes in. Anything that
can read your browser profile can read the key. We do not encrypt it, we do not protect it, and
it is not safer here than anywhere else. The settings page says so at the point where you paste
it.

**Use a key you can revoke.** The key is sent only to the endpoint you configured, and only when
you press the summarise button.

---

## 5. What we do not do

- We do not sell your data or transfer it for advertising or any purpose unrelated to the
  disclosed Discussion, Archive, Wikipedia and Digest features. No project server receives it.
- We do not use your data for advertising, profiling, credit assessment or lending decisions.
- We run no analytics, no crash reporting, no A/B testing and no telemetry.
- We do not read the content of the pages you visit. Parle uses the address and the tab title,
  which the browser hands the extension directly. On Hacker News, Reddit, X, Bluesky, Lemmy and
  Lobsters — and nowhere else — it reads that page's own links, thread identifiers, scores and comment counts, keeps
  only those pointers and numbers, and discards the markup.
- We do not execute remotely-hosted code. Everything that runs is in the package you installed.

---

## 6. Three things this policy will not claim

These are stated as refusals so that no part of this document can be read as making them. Each
was measured, and each is unsupportable.

1. **Not "your browsing is private."** It is not. With automatic lookups on, every page you read
   that is not skipped produces requests carrying its page or site to each enabled discussion
   service. With automatic lookups off, the same requests happen only when you ask on that page.
2. **Not "we exclude addresses carrying credentials."** The rules catch several common shapes. A
   short share link that looks like an ordinary address cannot be detected at all.
3. **Not "we protect sensitive categories."** A list of sites cannot cover health, internal
   company tools or documents, and the best lists available are measurably missing well-known
   providers.

The skip list is a floor, not a guarantee. It is why the extension gives you a global switch to
turn automatic lookups off, a per-site pause, and the ability to add your own entries.

---

## 7. Children

Parle is not directed at children. The project operates no account or backend and receives no
reader data, including from children; the extension's disclosed third-party requests work the
same way regardless of age.

## 8. Your rights

Because no data about you is ever transmitted to or held by this project, there is nothing for
us to disclose, correct, export or delete on request. Everything Parle holds is on your own
device and under your own control; the settings page deletes it, and the Safari companion app can
delete its Recent list directly.

Requests concerning data held by Hacker News, Reddit, Bluesky, Lemmy, Lobsters, the Internet
Archive, Wikipedia or your chosen AI Provider must go to those organisations, under their own policies.

## 9. Changes

Material changes to what Parle sends or stores will be reflected here and in the extension's own
first-run and settings copy in the same release. The extension's copy is generated from the
build, so it cannot silently drift from what the code does.

## 10. Contact

Issues and questions: <https://ziahamza.com/parle/support> or
<support@ziahamza.com>.

Source, under AGPL-3.0-only, including every disclosure above as testable code:
<https://github.com/ziahamza/parle-extension>
