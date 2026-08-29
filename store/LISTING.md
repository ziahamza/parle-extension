# Chrome Web Store submission — Parle

Item `bbigpojahnmkdbdnbcmadnhbjlemibom` · **Published, public** — v3.1.4 live at 100% as of 21 August 2026 (3.1.1–3.1.3 were folded into it and never submitted) — the Manifest V3 revival was accepted and the takedown is over.

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
| Version | `2.90` | `3.1.4` (set in `apps/extension/package.json` — the only place; see `store/version.ts`) |
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

**128 characters.** This is the line most people read, so it carries both halves: what you get,
and what it costs.

```
See the Hacker News, Reddit, Bluesky, Lemmy and Lobsters discussions of a page. Finding them tells those sites the page or site.
```

Do **not** replace this with the manifest's `description` string ("See what Hacker News,
Reddit, Bluesky, Lemmy and Lobsters have already said about the page you are reading."). That sentence is true but says
nothing about the sending, and this field is one of the two places Chrome's Limited Use policy
looks for prominent disclosure.

### 1.3 Description

Paste the whole of [`description.txt`](./description.txt), verbatim. It is the canonical copy; this
guide deliberately does not duplicate 7,196 characters that would otherwise drift. The store
renders it as **plain text** — no Markdown — so its capital headings and hyphen bullets are
intentional. `check-listing.ts` enforces the 16,000-character limit and both load-bearing disclosure
headings.

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
Parle's single purpose is to help a reader understand the page they are viewing by showing its public Discussions and disclosed context: kept copies, Wikipedia citations, and named third-party publisher Standing.
```

Everything else exists to serve that sentence: the lookups find Discussions and context, the panel
displays them, the Digest summarises Discussions, and settings govern whether and where requests happen.

### 2.2 Permission justifications

**Read the built manifest, not this table, if they ever disagree** —
`apps/extension/.output/chrome-mv3/manifest.json`. As built at version `3.1.4` the declared
permissions are exactly: `tabs`, `scripting`, `webNavigation`, and host permissions
`http://*/*` and `https://*/*`. `storage` is deliberately **not** requested; everything Parle
writes to disk goes through the Cache API, which needs no permission. There is no
`declarativeNetRequest`, no `cookies`, no `history`, no `<all_urls>`.

The console requires a non-empty justification for each. Paste these.

#### `tabs`

```
Parle needs the address and the title of the page in the active top-level tab. The address is what Parle asks Hacker News, Reddit, Bluesky, Lemmy and Lobsters about. When the reader opens Parle, it also asks the Internet Archive and Wikipedia about that address. The title never leaves the machine: it labels what the reader is looking at inside the extension's own surfaces. It used to be a second search term; ADR 0020 deleted that search, and `apps/extension/e2e/parle.e2e.ts` asserts in a real browser that the title is never transmitted. Without "tabs" the background service worker has no way to learn which page the reader is on. The alternative — a content script injected into every page purely to report its own URL — would put our code on every site the reader visits, which is strictly more invasive for the same information. Parle uses the tab's URL and title only; it does not read tab content through this permission.
```

#### `scripting`

```
Parle uses "scripting" to inject its on-page mark and its discussion panel, and only into pages where at least one discussion was actually found. On a page nobody has discussed, nothing is injected at all — no element of ours is added to the document. Injection is done on demand from the background service worker rather than by a broad content-script declaration, precisely so that the extension's code is not present on pages where it has nothing to do. It is not used to read the content of arbitrary sites, and the one page style it ever touches is at the reader's own click: pinning the panel sets one margin on the page's root element — on whichever side the reader has dragged the panel to — so the two sit side by side, and unpinning restores it exactly.
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

2. Issuing cross-origin requests from the extension's own context. Discussions are found through hn.algolia.com, reddit.com, public.api.bsky.app, lemmy.world and lobste.rs. Short links already visible on a Network page may be resolved at their own arbitrary host so Parle records the destination rather than the tracker. Opening Parle asks archive.org for a kept copy, web.archive.org for its capture history, and en.wikipedia.org for citations; none is asked merely because the reader browsed there. The optional automatic-Archive switch is off by default and says before it is enabled that it will ask archive.org on navigation. Comments are read only after the reader opens a Discussion or asks for a Digest, from Hacker News and Reddit; news.ycombinator.com supplies a Hacker News thread's displayed order. Those comment requests carry the Discussion's public identifier, never the address being read. raw.githubusercontent.com supplies one static skip-list file at most daily after first-run consent, identical for every install and carrying no cookies, identifiers or page addresses. A Provider endpoint is contacted only when the reader configured it and explicitly asks for a Digest. There is no server operated by this project.

3. Running one declared content script on news.ycombinator.com, reddit.com, x.com, bsky.app, the enumerated Lemmy instances and lobste.rs, and nowhere else. On those Network pages only, it reads the links, thread identifiers, scores and comment counts already on screen, and stores those pointers locally so that a link the reader then clicks already has its Discussion attached with no network request. It sends nothing to X; the code that would query X is compiled out of this build. It reads nothing on any other site.

The permission is scoped to http and https deliberately, rather than <all_urls>, because Parle will never issue a lookup for a file:// or ftp:// address and asking for reach it cannot use is reach a reviewer has to take on trust.

What this permission does NOT do: Parle does not read page content on arbitrary sites, does not modify pages other than to add its own mark and panel — and, when the reader pins that panel, to make room for it beside the page: one margin on the page's root element, undone the moment they unpin (elements the page fixes to the viewport do not move) — and does not inject anything into a page it found nothing for.
```

### 2.3 Remote code

Answer: **No, I am not using remote code.**

If a justification box appears:

```
All executable code is contained in the uploaded package. There is no eval, no new Function on fetched strings, no remotely-hosted script or module, and no bundled interpreter. The things fetched at runtime are data: search results from Hacker News, Reddit, Bluesky, Lemmy and Lobsters; comment trees from Hacker News and Reddit; Archive holding data; Wikipedia citation data; HTML scanned for links or Hacker News comment order; one add-only JSON skip-list artifact from the public source repository; and text returned by an AI Provider the reader configured. The bundled publisher-Standing artifact is local and makes no runtime request. Every remote answer is decoded as data and is never executed.
```

---

## 3. Privacy tab — data usage

### 3.1 What to tick

Chrome asks which of nine categories the item collects. **Over-disclosure is the safe direction
and it is the strategy here.** Tick these three:

| Category | Tick | Why |
|---|---|---|
| **Web history** | ✅ **YES** | The address of nearly every non-skipped page the reader opens is transmitted to Hacker News, Reddit, Bluesky, Lemmy and Lobsters after they choose automatic lookups. Opening Parle also sends it to Archive and Wikipedia. This is the disclosure the whole submission turns on. Do not leave it unticked. |
| **Website content** | ✅ **YES** | On Hacker News, Reddit, X, Bluesky, Lemmy and Lobsters the content script reads links, thread ids, scores and comment counts from the page. Opening a Discussion fetches its comments; pressing summarise additionally sends comment text to the reader's own AI Provider. Neither happens on a page load nor for a Discussion the reader did not open or summarise. |
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
| I do not sell or transfer user data to third parties, apart from the approved use cases | ✅ | Nothing is sold. Addresses go only to the five discussion services needed to find Discussions, and on panel open to Archive and Wikipedia for the two context lines. Comment text goes only to a Provider the reader configured and explicitly invoked. These are the item's disclosed single purpose, not secondary transfers. There is no advertising, broker or project backend; the static skip-list download transfers no user data. |
| I do not use or transfer user data for purposes unrelated to my item's single purpose | ✅ | Every transfer finds Discussions, supplies the disclosed Archive or Wikipedia context, or produces a Digest the reader explicitly requested. There is no secondary use — no analytics, telemetry, profile or model training by us. |
| I do not use or transfer user data to determine creditworthiness or for lending purposes | ✅ | Nothing to explain. |

### 3.3 Limited Use — why this listing is built the way it is

Chrome's Limited Use policy permits collection of web browsing activity only for a user-facing
feature described prominently **on the store listing page *and* in the product's own user
interface**; enforcement of the 2026 revision began 1 August 2026. Parle satisfies both halves,
and the second one is checkable:

- **In the listing**: the disclosure is in the 132-character summary, and is the first section
  of the description under the opening paragraph.
- **In the product**: the install opens a screen titled *What Parle sends* that names all five
  discussion services plus Archive and Wikipedia, states plainly "They see it. It is not anonymous.", says the skip list will
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
| The address goes to five discussion services; opening Parle also asks Archive and Wikipedia; the title does not leave | ADR 0005, ADR 0020; `README.md` § *What Parle sends, and to whom*; `parle.e2e.ts` wire assertions |
| Nothing is sent before the first-run question is answered | `apps/extension/src/policy/Choices.ts`, asserted in `src/app/FirstRun.test.ts` on outbound requests |
| The skip list is incomplete | `research/ticket-03.md` §1, §3, §7 — including the measured list of well-known providers the best available sources are missing |
| The three refusals, verbatim | `research/ticket-03.md` §7; shipped in `src/view/settingsCopy.ts` (`LONGER.refuses`) |
| API key stored as ordinary text | ADR 0014, ADR 0015; shipped in `settingsCopy.ts` (`PROVIDER.stored`) |
| X compiled out | `apps/extension/wxt.config.ts` — `__PARLE_X__: "false"` |
| Nothing injected on an undiscussed page | `e2e/parle.e2e.ts`, which walks every shadow root and expects none |
| A Discussion's comments are fetched when the panel opens that Discussion — never in the background, and never for a page the reader has not opened the panel on. The Digest is separate and always needs its own click | `src/view/render.ts` (`networkRoom`), `src/ai/Digest.test.ts`, `src/app/Summarise.test.ts` |
| No server | there is no backend in the repository; the one project-hosted request is a static data file served from the repository itself (`artifacts/exclusions.json`), and `policy/ExclusionUpdates.ts` is the whole client for it |

---

## 5. "Why can't I submit?" — the checklist

Ordered by how likely each is to be the thing greying out the button. The console's own
*Why can't I submit?* link lists the live blockers; work this list and then re-read it, because
it may name an account-level item nothing in the repo can fix.

### 5.1 At least one screenshot — headed regeneration completed at `f09c366`

The store requires **1280×800 or 640×400**, PNG or JPEG, max 5.

`store/screenshots/` holds the five current, last-reviewed 1280×800 frames. The headed
release-readiness run regenerated them from `f09c366`; the package audit passed all five, and a
person visually reviewed them on 29 August 2026, including frame 2's five-Network and
Archive/Wikipedia disclosure. They are upload candidates for this checkpoint. Regenerate and
review them again after any reader-visible change, and upload them in filename order:

| # | File | What it shows |
|---|---|---|
| 1 | `01-the-discussions-beside-the-article.png` | The in-page discussion panel open on a real Wikipedia article: live Hacker News Discussions, their comments, and the article still readable beside them. (Unpinned, the panel floats over the page's edge; the pin pushes the page over instead, on whichever side it was dragged to.) |
| 2 | `02-what-parle-sends-before-anything-is-looked-up.png` | The first-run screen, before the question is answered. **This is the disclosure**, and second in the carousel is where a reviewer meets it without scrolling. |
| 3 | `03-the-mark-and-its-count.png` | The whole of what Parle draws on a page: one compact mark in the corner carrying a count. The emptiness of the rest of the frame is the point. |
| 4 | `04-where-parle-asked-and-what-each-answered.png` | The toolbar surface: every place Parle asked and what it answered on that run, with X **not asked — not in this build**. |
| 5 | `05-the-most-discussed-thread-open.png` | The busiest thread open in the panel, comments being read beside the article. |

Do not reorder them. 1 and 2 are the two a person actually sees, and they are the product and
its cost in that order.

To regenerate them (needs a real visual Chrome and a live network; ~4 minutes):

```bash
cd <parle-extension checkout>
pnpm --filter @parle/extension e2e:store
identify store/screenshots/*.png     # every line must read 1280x800
```

That drives the real extension in a real Chrome — the panel, the popup and the toolbar icon are
browser chrome, so the run photographs the whole browser window rather than the page viewport. The article
and its Discussions are fetched live; the run prints what each Place answered and lists anything
that went wrong under `LOOK AT THESE BEFORE UPLOADING`. A warning-free run is mechanically clean,
not visual approval: inspect every frame, confirm frame 2 carries the current disclosure, and only
then call the set uploadable. A failed run leaves the last-reviewed directory untouched. See
`apps/extension/e2e/store.e2e.ts`.

**No frame uses a stand-in.** Screenshot 5 was a Digest until 3.1.0, written by the local stand-in
Provider in `apps/extension/e2e/provider.ts` — quoting real comments, but summarising them with a
fixture. That is not a feature to show a reviewer, so the frame is now the busiest thread open with
a reply tree expanded, and the Provider machinery has been taken out of the shoot entirely. **Do
not put a Digest back in slot 5** without a real Provider behind it; the shoot no longer connects
one, and a frame photographed from a profile with a connected Provider is not the state a new
reader is in.

Do **not** upload anything from `apps/extension/.e2e-shots/`. Those are the design-review shots —
1280×900 (rejected), 360×457 (rejected), or 128×128 crops of the mark (rejected).

### 5.2 A 128×128 store icon — the other required asset

The Store Listing tab will not accept a submission without one.

Upload **`/home/hzia/repos/parle/store/icons/128.png`** — the speech-bubble mark in white on
`#ff6600`.

That orange is deliberate and is the *only* place this project spends a colour on itself: the rule
everywhere else is that a hue means which network a thread came from. A toolbar icon cannot follow
that rule, because the ink disappears against a dark Chrome theme and the paper against a light one.
`store/make-art.ts` carries the full reasoning. If you are reading "accent blue" anywhere, it is a
stale copy of this file — the blue was removed along with the rest of the house colour.

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
pnpm typecheck                                    # 27/27
pnpm --filter @parle/extension build              # writes .output/chrome-mv3/
pnpm --filter @parle/extension exec wxt zip       # writes .output/parleextension-<version>-chrome.zip
```

- [ ] **`manifest.json` must be at the root of the zip.** The old
      `apps/extension/.output/parle-chrome.zip` nested everything under a `chrome-mv3/` folder —
      the store rejects that with "manifest file is missing or unreadable". It has been deleted
      so it cannot be uploaded by mistake. `wxt zip` produces the correct shape; never `zip -r`
      the output directory.
- [ ] **Version must exceed the version already on the item.** The store holds `3.1.4`; the next
      update is whatever `store/version.ts --set` says next. It is set in `apps/extension/package.json` and **nowhere else** —
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
