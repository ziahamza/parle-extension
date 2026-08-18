# Chrome Web Store submission — Parle

Item `bbigpojahnmkdbdnbcmadnhbjlemibom` · **Published, public** as of 18 August 2026 — v3.0.0 live, v3.1.0 the next submission — the Manifest V3 revival was accepted and the takedown is over.

The two long fields below now also live as paste-ready plain text at `store/summary.txt` and
`store/description.txt`, which is what `store/check-listing.ts` audits and what the scheduled
`release-readiness` run publishes as an artifact. This file remains the reference explaining why
each sentence says what it says.

Everything below is **copy-paste ready**. Fenced blocks are the literal text for a console
field; prose outside them is instruction. Field names match the Developer Dashboard's own
labels. Nothing here says anything the extension does not say in its own interface — that is
deliberate, and §4 explains why it is the load-bearing part of the submission.

**Order of work:** §5 (the checklist) is what un-greys the Submit button. §1–§4 are what goes in
the fields. Do §5 first if you only have ten minutes.

**Shipping a new version does not happen here.** `store/RELEASE.md` is the procedure, and it is
automated — bump `apps/extension/package.json`, push to `main`. For the description and the
screenshots, which have no API, `store/LISTING.md` is the paste. `store/SUBMIT.md` is the record
of the first submission, kept because its privacy answers and permission justifications are what
a re-review asks about again; it is not a list to redo.

---

## 0. What changed since the taken-down listing

| Field | Old (2015) | Now |
|---|---|---|
| Manifest | V2 | **V3**, on Chrome, Firefox and Safari from one codebase. This is the entire reason the item was removed, and it is the one thing already fixed. |
| Version | `2.90` | `3.1.0` (set in `apps/extension/package.json` — the only place; see `store/version.ts`) |
| Tiles | "INTRODUCING — A NEW WAY TO BROWSE THE WEB" | **Replace or delete them.** They describe a product that no longer exists. Replacements: `store/small-promo-tile-440x280.png`, `store/marquee-promo-tile-1400x560.png`. |
| Icon | (whatever 2015 shipped) | `store/icons/128.png`, and the same mark now inside the package |
| Screenshots | none | five, from the real-Chrome harness — see §5.1 |
| Official URL | `parle.co` | **Clear it.** The domain is lost; pointing the listing at a domain you do not control is a misrepresentation risk and cannot be verified. Use `https://ziahamza.com/parle`. |
| Description | 2015 product | §1.3 |
| Privacy tab | (predates it) | §2, §3 — all of it is now mandatory |

---

## 1. Store listing tab

### 1.1 Item name

```
Parle
```

Keep this **byte-identical to the `name` field in `manifest.json`**. A listing title that
differs from the manifest name is a rejection ground under the misrepresentation policy. It
already matches — do not "improve" it.

### 1.2 Summary (132 characters maximum)

**123 characters.** This is the line most people read, so it carries both halves: what you get,
and what it costs.

```
See the Hacker News and Reddit discussions of the page you are reading. Finding them sends those sites that page's address.
```

Two alternates, if the primary reads as too heavy:

- 118 chars — `The Hacker News and Reddit discussions of the page you are reading. Finding them sends those sites the page's address.`
- 117 chars — `Shows the Hacker News and Reddit discussions of the page you are reading. Finding them sends those sites its address.`

Do **not** replace this with the manifest's `description` string ("See what Hacker News and
Reddit have already said about the page you are reading."). That sentence is true but says
nothing about the sending, and this field is one of the two places Chrome's Limited Use policy
looks for prominent disclosure.

### 1.3 Description

Paste verbatim. The store renders this as **plain text** — no Markdown — so the headings are in
capitals and the bullets are hyphens on purpose. 5,454 characters, well inside the 16,000 limit.

```
Parle shows you what has already been said about the page you are reading.

Open an article and Parle looks for the Hacker News and Reddit threads about it. If there are any, a small mark appears in the corner of the page with a count. Click it and the discussions open in a panel beside the page: which thread, how many points, how many comments, how long ago, and — where a popular piece was submitted several times — which submission actually got the replies. Click the toolbar button instead and Parle tells you every place it asked and what came back from each, including the places that refused and the places it deliberately did not ask.

If a page has never been discussed, Parle adds nothing to it at all. Not an empty panel — nothing.

WHAT IT SENDS, AND TO WHOM

To find out whether anyone has discussed a page, Parle sends that page's address to Hacker News and to Reddit. That is the same thing as pasting the link into their search boxes. It is not anonymous. Those companies see the address of the page you are reading. The page's title is not sent — it is used on your machine to label what you are reading, and it stays there.

By default this happens on every page you open except the ones Parle skips. Parle asks you which way you want it on the very first screen, before it has sent anything anywhere — and until you answer that question, no address leaves your browser at all. Choose "Only when I ask" and nothing is ever sent as you browse; the toolbar button still looks up any page on demand.

Parle skips banks, webmail, health, government, adult sites, social feeds, and private or internal addresses, plus addresses that visibly carry a token or a credential. It never sends the part of an address after the "#", and it strips tracking parameters before sending.

That is a list. It is incomplete, it will miss things, and it cannot see a private share link that looks like an ordinary address. It is a floor, not a guarantee. You can read it, add to it, override any entry, pause Parle on any site, and switch automatic lookups off entirely.

THREE THINGS PARLE WILL NOT CLAIM

- Not "your browsing is private". It is not. Every page you read that is not skipped produces requests to other companies carrying that page's address.
- Not "we exclude addresses carrying credentials". The rules catch several common shapes. A short share link that looks like an ordinary address cannot be detected at all.
- Not "we protect sensitive categories". A list of sites cannot cover health, internal company tools or documents, and the best lists available are measurably missing well-known providers.

Those three sentences are also inside the extension, on the first screen and on the settings page. Nothing here was written for the store and softened in the product.

SUMMARIES, IF YOU WANT THEM

Finding discussions needs no AI and never will. Summarising them does, and you supply it. Connect a Provider on the settings page — an API key of your own (OpenAI, or anything speaking the same shape, including a model running on your own machine), or your browser's built-in model where it has one — and the panel offers a Digest.

A Digest never happens on its own. The panel first tells you exactly how many discussions would be read and where their comments would be sent. Only then does the button do anything. Every statement in a Digest links to the specific comment it came from, and a statement that cannot be traced to a comment is discarded rather than shown.

With no Provider connected, everything else still works. There is no upsell wall.

WHAT IS ON YOUR DISK

Your settings — and, if you connected a Provider with an API key, that key, as ordinary text. A browser extension has nowhere private to put a key; Manifest V3 offers nothing better than the store every other setting goes in, so anything that can read your browser profile can read it. The settings page says so where you paste it. Use a key you can revoke.

And what Hacker News, Reddit and X showed you: while you are on one of those three sites, Parle notes the links on the page you are already looking at and which thread each came from. That is why a link you click on Hacker News already has its thread attached before the page finishes loading, with no request to anyone. It never leaves your machine. One button clears it.

WHAT PARLE DOES NOT DO

- There is no server. This project runs none and the extension never contacts one. No account, nothing to sign up for.
- No ads, no trackers, no analytics, no telemetry. Nothing about you reaches the people who wrote this, because there is nowhere for it to arrive.
- Parle does not read the content of the pages you visit. It uses the address, and the tab title which the browser hands it directly and which never leaves your machine. On Hacker News, Reddit and X only, it reads that page's own links and scores, and keeps only those pointers and numbers.
- X is not in this build at all — the code that would ask X is compiled out. Parle does run on x.com, to note the links you are already looking at, and it sends X nothing.

OPEN SOURCE

Every line is AGPL-3.0-only and public: https://github.com/ziahamza/parle-extension

STATUS

Early, and honest about it. Hacker News works end to end. Reddit is real, and often answers "refused us" rather than an answer — which Parle reports as refused, never as "nothing found", because those are opposite facts. An offline list that would let Parle skip asking about pages nobody has discussed is not built yet, and the toolbar says so in as many words rather than leaving you to guess.
```

### 1.4 Category

```
Social Networking
```

Reasoning, in case the console offers a different set: the function is surfacing conversation
from social sites about the page in front of you. **News & Weather** is the defensible runner-up
(the reader is usually on an article). Do **not** pick *Privacy & Security* — Parle transmits
browsing addresses, and filing it under a privacy category invites exactly the comparison it
loses.

### 1.5 Language

```
English (United States)
```

The copy uses British spellings in a few places (`Summarise`) because the extension's own
interface does; that is consistent, not an error. If you would rather the listing match the UI
exactly, `English (United Kingdom)` is equally fine — pick one and leave it.

### 1.6 The URL fields

| Field | Value | Note |
|---|---|---|
| Homepage / Official URL | `https://ziahamza.com/parle` | **Replace `parle.co`.** Checked on every scheduled run by `store/check-listing.ts`. |
| Support URL | `https://ziahamza.com/parle/support` | Public help, troubleshooting and contact page. |
| Privacy policy URL | see §5.3 | **Mandatory** — the privacy disclosures in §3 are non-empty, so the store will not accept a submission without one. |
| YouTube video | leave empty | Optional. |

---

## 2. Privacy tab — purpose and permissions

### 2.1 Single purpose

```
Parle's single purpose is to show the reader the public discussions that already exist about the web page they are currently viewing.
```

Everything else in the extension exists to serve that sentence: the lookups find the
discussions, the panel displays them, the Digest summarises them, and the settings govern
whether and where the lookups happen.

### 2.2 Permission justifications

**Read the built manifest, not this table, if they ever disagree** —
`apps/extension/.output/chrome-mv3/manifest.json`. As built at version `3.1.0` the declared
permissions are exactly: `tabs`, `scripting`, `webNavigation`, and host permissions
`http://*/*` and `https://*/*`. `storage` is deliberately **not** requested; the one thing
written to disk goes through the Cache API, which needs no permission. There is no
`declarativeNetRequest`, no `cookies`, no `history`, no `<all_urls>`.

The console requires a non-empty justification for each. Paste these.

#### `tabs`

```
Parle needs the address and the title of the page in the active top-level tab. The address is the search term it looks the page up with — it is what Parle asks Hacker News and Reddit about. The title never leaves the machine: it labels what the reader is looking at inside the extension's own surfaces. It used to be a second search term, asked of the same Networks; [ADR 0020](../docs/adr/0020-the-title-search-is-deleted.md) deleted that search, and `apps/extension/e2e/parle.e2e.ts` asserts in a real browser that the title is never transmitted. Without "tabs" the background service worker has no way to learn which page the reader is on. The alternative — a content script injected into every page purely to report its own URL — would put our code on every site the reader visits, which is strictly more invasive for the same information. Parle uses the tab's URL and title only; it does not read tab content through this permission.
```

#### `scripting`

```
Parle uses "scripting" to inject its on-page mark and its discussion panel, and only into pages where at least one discussion was actually found. On a page nobody has discussed, nothing is injected at all — no element of ours is added to the document. Injection is done on demand from the background service worker rather than by a broad content-script declaration, precisely so that the extension's code is not present on pages where it has nothing to do. It is not used to read or modify the content of arbitrary sites.
```

#### `webNavigation`

```
Parle must know when the address of the top-level frame has settled, so that one navigation produces exactly one lookup. "webNavigation" reports in-page and history-state navigations that tabs.onUpdated does not, which is the difference between noticing that a single-page news site moved to a different article and missing it entirely. It is also how Parle enforces two of its own limits: a redirect chain (a link shortener, then a consent interstitial, then the article) collapses into a single lookup at the destination rather than four, and sub-frames are excluded, so an embedded video or an advertising iframe never becomes a page Parle asks about.
```

#### Host permissions — `http://*/*` and `https://*/*`

This is the hard one. It is answered truthfully rather than minimised.

```
Parle's purpose is to tell a reader whether the page in front of them has been discussed. Which pages those are is not knowable in advance — there is no list of already-discussed pages shipped with this extension, and the set of pages a reader might open is the whole web. So the extension must be able to act on whatever page the reader is on. Concretely, broad host access is used for exactly three things:

1. Injecting the mark and the discussion panel into a page that turned out to have discussions. Parle cannot know which page that will be until it has asked, so it cannot enumerate hosts ahead of time. On pages with nothing to show, nothing is injected.

2. Issuing cross-origin requests from the extension's own context to hn.algolia.com and to reddit.com. These are the only two endpoints Parle contacts to find discussions. There is no server operated by this project, and the extension never contacts one.

3. Running one declared content script on news.ycombinator.com, reddit.com and x.com, and nowhere else. On those three sites only, it reads the links, thread identifiers, scores and comment counts already on the page the reader is looking at, and stores those pointers locally so that a link the reader then clicks already has its thread attached with no network request at all. It sends nothing to X; the code that would query X is compiled out of this build. It reads nothing on any other site.

The permission is scoped to http and https deliberately, rather than <all_urls>, because Parle will never issue a lookup for a file:// or ftp:// address and asking for reach it cannot use is reach a reviewer has to take on trust.

What this permission does NOT do: Parle does not read page content on arbitrary sites, does not modify pages other than to add its own mark and panel, and does not inject anything into a page it found nothing for.
```

### 2.3 Remote code

Answer: **No, I am not using remote code.**

If a justification box appears:

```
All executable code is contained in the uploaded package. There is no eval, no new Function on fetched strings, no remotely-hosted script or module, and no bundled interpreter. The only things fetched at runtime are data: JSON search results from Hacker News and Reddit, HTML that is parsed for links, and text returned by an AI Provider the reader configured. The AI Provider's output is decoded and validated against the material it was supposed to have been summarising before any of it is displayed, and it is never executed.
```

---

## 3. Privacy tab — data usage

### 3.1 What to tick

Chrome asks which of nine categories the item collects. **Over-disclosure is the safe direction
and it is the strategy here.** Tick these three:

| Category | Tick | Why |
|---|---|---|
| **Web history** | ✅ **YES** | The address of nearly every page the reader opens is transmitted to Hacker News and Reddit. This is the disclosure the whole submission turns on. Do not leave it unticked under any reasoning. |
| **Website content** | ✅ **YES** | On Hacker News, Reddit and X the content script reads links, thread ids, scores and comment counts from the page. Opening a Discussion in the panel fetches that Discussion's comments, because the comments are what the panel shows. Pressing the summarise button additionally sends comment text to the reader's own AI Provider. Neither happens on a page load, nor for a page whose panel was never opened. |
| **Authentication information** | ✅ **YES** | If the reader connects an AI Provider, their API key or token is held in extension storage and sent to the endpoint they configured. It is a credential the item handles, so it is declared. |

Leave these **unticked**, with the reason to give if a reviewer asks:

| Category | Tick | Why not |
|---|---|---|
| Personally identifiable information | ❌ | Nothing about the reader's identity is collected. Parle never asks for a name, email or address; there is no account. An address could incidentally contain an email — that is why the credential-shaped-parameter rules and the "you can add your own exclusions" control exist, but it is not collection. |
| Health information | ❌ | Never collected as a category. Health *sites* are on the skip list, which is a mitigation, not a collection. |
| Financial and payment information | ❌ | Never collected. No payments anywhere in the product. |
| Personal communications | ❌ | The discussions Parle reads are public posts on public sites, not private messages. Parle reads no mail, chat or DMs. |
| Location | ❌ | No geolocation permission, no IP-derived location, nothing. |
| User activity | ❌ | No clicks, keystrokes, mouse positions, scrolling or network monitoring. Parle observes navigation events only, and that is declared under Web history. |

### 3.2 The three certifications — tick all three

| Certification | Tick | The defence, if it is ever asked for |
|---|---|---|
| I do not sell or transfer user data to third parties, apart from the approved use cases | ✅ | Nothing is sold, and no data is transferred to any party other than (a) Hacker News and Reddit, which *is* the single purpose — sending the address is the only way to find out whether it was discussed; and (b) the AI Provider the reader chose and configured themselves, at their own explicit click. Both fall under "necessary to providing or improving the single purpose". There is no advertising, no data broker, and no server of ours. |
| I do not use or transfer user data for purposes unrelated to my item's single purpose | ✅ | Everything transmitted is transmitted in order to find or summarise discussions of the page the reader is on. There is no secondary use — no analytics, no telemetry, no profile, no model training by us. |
| I do not use or transfer user data to determine creditworthiness or for lending purposes | ✅ | Nothing to explain. |

### 3.3 Limited Use — why this listing is built the way it is

Chrome's Limited Use policy permits collection of web browsing activity only for a user-facing
feature described prominently **on the store listing page *and* in the product's own user
interface**; enforcement of the 2026 revision began 1 August 2026. Parle satisfies both halves,
and the second one is checkable:

- **In the listing**: the disclosure is in the 132-character summary, and is the first section
  of the description under the opening paragraph.
- **In the product**: the install opens a screen titled *What Parle sends* that names Hacker
  News and Reddit, states plainly "They see it. It is not anonymous.", says the skip list will
  miss things, and asks the reader to choose before anything is sent. Until that question is
  answered, no address leaves the browser — that is enforced in code, not promised, and the
  test suite asserts it against what actually went out on the wire. The same disclosure, plus
  the three refusals in §1.3, sits permanently at the top of the settings page.

A reviewer who opens the extension will find the listing and the interface saying the same
thing. That is the whole bet.

---

## 4. Where each claim comes from

Keep this section; it is what makes the submission answerable if a reviewer pushes back.

| Claim in the listing | Source |
|---|---|
| The address goes to Hacker News and Reddit; the title does not | ADR 0005, ADR 0020; `README.md` § *What Parle sends, and to whom*; `parle.e2e.ts` "never sends the page's title anywhere" |
| Nothing is sent before the first-run question is answered | `apps/extension/src/policy/Choices.ts`, asserted in `src/app/FirstRun.test.ts` on outbound requests |
| The skip list is incomplete | `research/ticket-03.md` §1, §3, §7 — including the measured list of well-known providers the best available sources are missing |
| The three refusals, verbatim | `research/ticket-03.md` §7; shipped in `src/view/settingsCopy.ts` (`LONGER.refuses`) |
| API key stored as ordinary text | ADR 0014, ADR 0015; shipped in `settingsCopy.ts` (`PROVIDER.stored`) |
| X compiled out | `apps/extension/wxt.config.ts` — `__PARLE_X__: "false"` |
| Nothing injected on an undiscussed page | `e2e/parle.e2e.ts`, which walks every shadow root and expects none |
| A Discussion's comments are fetched when the panel opens that Discussion — never in the background, and never for a page the reader has not opened the panel on. The Digest is separate and always needs its own click | `src/view/render.ts` (`networkRoom`), `src/ai/Digest.test.ts`, `src/app/Summarise.test.ts` |
| No server | there is no backend in the repository |

---

## 5. "Why can't I submit?" — the checklist

Ordered by how likely each is to be the thing greying out the button. The console's own
*Why can't I submit?* link lists the live blockers; work this list and then re-read it, because
it may name an account-level item nothing in the repo can fix.

### 5.1 At least one screenshot — almost certainly the current blocker

The store requires **1280×800 or 640×400**, PNG or JPEG, max 5.

**They already exist.** `store/screenshots/` holds five, at exactly 1280×800, and nothing has to
be cropped, padded or converted — upload the five files as they are, in filename order:

| # | File | What it shows |
|---|---|---|
| 1 | `01-the-discussions-beside-the-article.png` | The in-page discussion panel open on a real Wikipedia article: live Hacker News Discussions, their comments, and the article still readable next to them. |
| 2 | `02-what-parle-sends-before-anything-is-looked-up.png` | The first-run screen, before the question is answered. **This is the disclosure**, and second in the carousel is where a reviewer meets it without scrolling. |
| 3 | `03-the-mark-and-its-count.png` | The whole of what Parle draws on a page: one 32px mark in the corner carrying a count. The emptiness of the rest of the frame is the point. |
| 4 | `04-where-parle-asked-and-what-each-answered.png` | The toolbar surface: every place Parle asked and what it answered on that run, with X **not asked — not in this build**. |
| 5 | `05-a-digest-that-cites-what-it-came-from.png` | A Digest with three Findings, each with a followable Citation into the comment it came from. |

Do not reorder them. 1 and 2 are the two a person actually sees, and they are the product and
its cost in that order.

To regenerate them (needs a real visual Chrome and a live network; ~4 minutes):

```bash
cd /home/hzia/repos/parle
pnpm --filter @parle/extension e2e:store
identify store/screenshots/*.png     # every line must read 1280x800
```

That drives the real extension in a real Chrome — the panel, the popup and the toolbar icon are
browser chrome, so the run photographs the whole X root window rather than the page. The article
and its Discussions are fetched live; the run prints what each Place answered and lists anything
that went wrong under `LOOK AT THESE BEFORE UPLOADING`. **If it prints nothing under that
heading, the five files are good.** See `apps/extension/e2e/store.e2e.ts`.

**One caveat, on screenshot 5 only.** A Digest is written by the reader's own Provider, and there
is none on this machine, so that run connects the local stand-in in `apps/extension/e2e/provider.ts`.
It is given a writer that cannot invent: it reads the Brief the extension really sent and answers
with the comments' **own words, quoted**, citing the comment each one came from. Every sentence on
that screenshot was written by a person on Hacker News and every citation under it resolves. What
is standing in is the summarising, not the material. If you have a Provider of your own, reshoot
it; if not, it is defensible as it stands.

Do **not** upload anything from `apps/extension/.e2e-shots/`. Those are the design-review shots —
1280×900 (rejected), 360×457 (rejected), or 128×128 crops of the mark (rejected).

### 5.2 A 128×128 store icon — the other required asset

The Store Listing tab will not accept a submission without one.

Upload **`/home/hzia/repos/parle/store/icons/128.png`** — the speech-bubble mark on the
extension's own accent blue.

This was a blocker until very recently and is worth verifying rather than assuming. The same
mark now also ships *inside* the package: `apps/extension/public/icon/{16,32,48,128}.png`, which
WXT folds into the manifest automatically. Confirm it did, on the build you are about to upload:

```bash
python3 -c "import json;print(json.load(open('/home/hzia/repos/parle/apps/extension/.output/chrome-mv3/manifest.json')).get('icons'))"
# expect: {'16': 'icon/16.png', '32': 'icon/32.png', '48': 'icon/48.png', '128': 'icon/128.png'}
```

If that prints `None`, the icons are missing from the package and Chrome will show the generic
grey puzzle piece in the toolbar — not a rejection ground, but a poor look on an item that was
just taken down for being abandoned.

### 5.3 A privacy policy URL — mandatory once §3 is non-empty

The full policy is written and ready at
**`/home/hzia/repos/parle/store/privacy-policy.md`**. It has to be reachable at a public URL
before it can go in the field. Cheapest options, in order:

1. Commit and push it, then use the GitHub blob URL:
   `https://ziahamza.com/parle/privacy`
2. Enable GitHub Pages on the repo and serve it as HTML — nicer to read, and it survives a
   default-branch rename.

Whatever you choose, the URL must be live *before* you submit; the store fetches it. Do not
point it at `parle.co`.

### 5.4 Every privacy field filled in

The submit button stays greyed while any of these is empty:

- [ ] Single purpose (§2.1)
- [ ] A justification for **each** of `tabs`, `scripting`, `webNavigation` (§2.2)
- [ ] The host permission justification (§2.2)
- [ ] The remote code question answered (§2.3 — *No*)
- [ ] The data-use category checkboxes (§3.1)
- [ ] **All three certifications ticked** (§3.2) — a single unticked box blocks submission
- [ ] Privacy policy URL (§5.3)

### 5.5 Store listing fields

- [ ] Item name (§1.1) — matches the manifest
- [ ] Summary, ≤132 chars (§1.2)
- [ ] Description (§1.3)
- [ ] Category (§1.4)
- [ ] Language (§1.5)
- [ ] Store icon 128×128 (§5.2)
- [ ] ≥1 screenshot at 1280×800 (§5.1)
- [ ] **Replace the 2015 promotional tiles.** The existing small tile (440×280) and marquee
      (1400×560) read "INTRODUCING — A NEW WAY TO BROWSE THE WEB" and describe a product that no
      longer exists — a misrepresentation risk on a listing under review. Neither size is
      required for submission, so deleting them is a valid answer, but replacements are ready:
      `store/small-promo-tile-440x280.png` and `store/marquee-promo-tile-1400x560.png`.
- [ ] Official URL cleared of `parle.co` (§1.6)

### 5.6 The package

**Uploading a package by hand is no longer the way this ships** — `store/RELEASE.md` covers the
automated path, and the manual commands below are the fallback.

`wxt zip` names its artifact `parleextension-<version>-chrome.zip`, and that version is the
manifest's, because both now come from `apps/extension/package.json`. They used to disagree —
the file said `0.0.0` while the manifest said `3.0.1` — which is why a copy to
`store/parle-chrome-store.zip` existed at all. It does not need to any more: the filename says
which version it is.

```bash
cd /home/hzia/repos/parle
pnpm typecheck                                    # 20/20
pnpm --filter @parle/extension build              # writes .output/chrome-mv3/
pnpm --filter @parle/extension exec wxt zip       # writes .output/parleextension-<version>-chrome.zip
```

- [ ] **`manifest.json` must be at the root of the zip.** The old
      `apps/extension/.output/parle-chrome.zip` nested everything under a `chrome-mv3/` folder —
      the store rejects that with "manifest file is missing or unreadable". It has been deleted
      so it cannot be uploaded by mistake. `wxt zip` produces the correct shape; never `zip -r`
      the output directory.
- [ ] **Version must exceed the version already on the item.** The store holds `3.0.0`; this
      update is `3.1.0`. It is set in `apps/extension/package.json` and **nowhere else** —
      `wxt.config.ts` deliberately no longer carries a version, and `store/version.ts` is what
      bumps it. CI compares against the store and refuses anything not strictly greater.
- [ ] Confirm the uploaded manifest declares exactly `tabs`, `scripting`, `webNavigation`,
      `http://*/*`, `https://*/*` — the justifications in §2.2 are written against
      that list, and an extra permission with no justification blocks submission.

### 5.7 Account-level blockers — nothing in the repo can fix these

These are the ones that surprise people, because the console reports them on a different page
from the item:

- [ ] **Publisher contact email set and verified.** Account → Contact email. An unverified email
      blocks submission for every item on the account.
- [ ] **2-Step Verification enabled** on the Google account that owns the publisher profile.
      Required for publishing.
- [ ] **One-time developer registration fee paid.** Almost certainly already true for a 2015
      item, but confirm — a lapsed account shows the same greyed button.
- [ ] **Distribution tab complete**: visibility (Public), regions/countries selected, pricing
      (Free). A taken-down item sometimes has its distribution settings cleared.
- [ ] **Read the console's own *Why can't I submit?* text and diff it against this list.** A
      taken-down item can carry a state that requires acknowledging the removal, or an appeal,
      before a new version is accepted. Nothing in this repository can tell you whether that
      applies to item `bbigpojahnmkdbdnbcmadnhbjlemibom` — the console can.

### 5.8 Before you press submit — the five-minute dry run

The reviewer will do this, so do it first. Load `.output/chrome-mv3/` unpacked into a clean
profile and check that:

- [ ] The first screen opens on install and says *What Parle sends*.
- [ ] Nothing is requested before you answer it (DevTools → Network on the service worker).
- [ ] `https://www.nature.com/articles/d41586-024-02012-5` produces a mark and a panel.
- [ ] A page nobody has discussed adds nothing to the DOM.
- [ ] Visit `proton.me`, `coinbase.com`, `bsky.app` and `outlook.office.com` and check what the
      toolbar button says on each. Reviewers test exactly these domains, and the research file
      records that the best available skip lists are measurably missing several of them. If one
      of them is *not* skipped, that is not a listing problem — but you want to know it before
      a reviewer tells you.

---

## 6. What is deliberately not in this package

- **Firefox and Safari listings.** The same build targets both; their store requirements differ
  and neither is on this critical path.
- **A second set of screenshots.** `store/screenshots/` holds the five, at 1280×800, and §5.1
  says how to regenerate them. They will go stale the moment the interface changes, which is why
  the command that makes them is a one-liner rather than a list of crops.
- **Anything under `apps/extension/src/`.** It was being edited concurrently while this package
  was written. Only the `version` field in `wxt.config.ts` was touched.
