# SUBMIT — Parle, Chrome Web Store

Item **`bbigpojahnmkdbdnbcmadnhbjlemibom`** · **Published, public, v3.0.0 at 100%** as of
18 August 2026. The Manifest V2 takedown is over: the V3 revival was accepted.

**This file is now history, not procedure.** It records the first submission, and it is worth
keeping because the privacy tab, the permission justifications and the data-use declarations are
answered here and are what a re-review will ask about again. For shipping a new version, see
`store/RELEASE.md` — releases are automated and touch no browser. For the description and the
screenshots, see `store/LISTING.md`.

What follows is that submission as it was worked, top to bottom — every step a click, an upload
or a paste. Read it as the record of what was answered and why, not as a list to redo. The paths
and the package checksum below are from August 2026 and are not maintained; `store/RELEASE.md`
§"Doing it by hand" has the current commands.

**Keep two things open:**

- this file, and
- **`store/listing.md`** — the five long paste blocks live there (the description and the four
  permission justifications). This file says *where each goes and in what order*; that one holds
  the text. Everything short is inlined here so you are not bouncing for a one-liner.

**Console:** <https://chrome.google.com/webstore/devconsole> → the Parle item.

---

## 0. First, the one thing this document cannot know

Before you change anything, click **"Why can't I submit?"** in the console and read it. It lists
the live blockers, and it is the only authority on why the button is grey right now.

- [ ] Read it. Write down every line it names.
- [ ] Work steps 1–7 below.
- [ ] Read it again.

Our best guess is §3.6 — **the draft has an empty screenshot slot, and the store will not accept
a submission without at least one 1280×800 or 640×400 image.** That is a real requirement and it
is one we can and did remove: five screenshots at exactly 1280×800 are sitting in
`store/screenshots/`.

But a **taken-down** item can also carry a state that no file in this repository can see — a
removal that has to be acknowledged, or an appeal that has to be filed, before a new version is
accepted at all. **If the checklist below does not clear the button, copy the "Why can't I
submit?" text verbatim and send it back.** That sentence is the whole of what we are missing.

---

## 1. Account-level blockers — do these first

These are reported on a *different page* from the item, they block every item on the account, and
they are what surprises people. None of them can be fixed from this repository.

- [ ] **Publisher contact email set and verified.** Account → Contact information. An
      *unverified* email greys out submit for every item you own. Verification is an emailed
      link; check spam.
- [ ] **2-Step Verification enabled** on the Google account that owns the publisher profile.
      Required to publish, no exceptions.
- [ ] **One-time developer registration fee paid.** Near-certain for a 2015 item, but a lapsed or
      migrated account shows the same grey button.
- [ ] **Distribution tab still populated.** Visibility **Public**, regions selected, pricing
      **Free**. A takedown sometimes clears these, and an empty distribution blocks submission
      while looking like a listing problem.

---

## 2. Upload the package

**Upload this file:**

```
/home/hzia/repos/parle/store/parle-chrome-store.zip
```

Package tab → **Upload new package**. 143,640 bytes, 21 files, `manifest.json` at the archive
root.

```
sha256  7871f6bf985d5501cd91dd772941c79e82d5169b61b55dae1c74073528c2d1ab
```

That is the exact artifact every check in this document was run against. It was built from the
working tree on 10 August 2026 — **if `apps/extension/src/` has changed since, rebuild it**
(step 9) rather than uploading this one, and the checksum will differ, which is the point of
printing it.

- [ ] Uploaded.

### 2.1 Version — the one thing that can reject the upload outright

The old MV2 item is version **`2.90`**. The revival was submitted as **`3.0.0`**; this update is
**`3.0.1`**, satisfying the store's
requirement that an uploaded version be strictly greater.

### 2.2 What the console should show after the upload

**As uploaded in August 2026**, and left at those values deliberately — this table is the record
of that submission, not a description of the current build. Today's package is `3.1.0` and no
longer requests `sidePanel`; `store/listing.json` holds the live permission list and
`store/check-release.mjs` fails until the two agree.

The rule the table exists for still stands: if what the console shows differs from what the
justifications in step 4 were written against, stop — an undeclared extra permission blocks
submission on its own.

| | Value |
|---|---|
| Manifest version | **3** |
| Name | `Parle` |
| Version | `3.0.1` |
| Permissions | `tabs`, `scripting`, `webNavigation` |
| Host permissions | `http://*/*`, `https://*/*` |
| Icons | 16, 32, 48, 128 |

To check the file you are about to upload without opening a browser:

```bash
python3 - <<'PY'
import zipfile, json
z = zipfile.ZipFile('/home/hzia/repos/parle/store/parle-chrome-store.zip')
n = z.namelist(); m = json.loads(z.read('manifest.json'))
print("manifest.json at root:", 'manifest.json' in n, "| files:", len(n))
print("mv:", m['manifest_version'], "| name:", m['name'], "| version:", m['version'])
print("permissions:", m['permissions'])
print("host_permissions:", m['host_permissions'])
print("icons:", sorted(m['icons']))
print("no pinned key (correct for the store):", 'key' not in m)
PY
```

Expected, verbatim:

```
manifest.json at root: True | files: 21
mv: 3 | name: Parle | version: 3.0.1
permissions: ['tabs', 'scripting', 'webNavigation']
host_permissions: ['http://*/*', 'https://*/*']
icons: ['128', '16', '32', '48']
no pinned key (correct for the store): True
```

`storage` is deliberately absent — the only thing written to disk goes through the Cache API,
which needs no permission. There is no `declarativeNetRequest`, no `cookies`, no `history`, no
`identity`, no `<all_urls>`.

---

## 3. Store listing tab

Fields in the order the console presents them.

### 3.1 Item name

```
Parle
```

- [ ] Pasted. It is **byte-identical to the manifest's `name`**, and it has to stay that way — a
      listing title that differs from the package is a rejection ground under misrepresentation.
      Do not improve it.

### 3.2 Summary (132 characters max — this is 123)

```
See the Hacker News and Reddit discussions of the page you are reading. Finding them sends those sites that page's address.
```

- [ ] Pasted. Two shorter alternates are in `listing.md` §1.2 if this reads too heavy. Do **not**
      substitute the manifest's `description` string — it is true but silent about the sending,
      and this field is one of the two places Chrome's Limited Use policy looks for the
      disclosure.

### 3.3 Description

- [ ] **Open `store/listing.md` §1.3 and paste the whole fenced block.** 5,454 characters, well
      inside the 16,000 limit. The store renders it as plain text, so the capitalised headings
      and hyphen bullets are deliberate, not un-rendered Markdown.

Its second section is `WHAT IT SENDS, AND TO WHOM` and its third is `THREE THINGS PARLE WILL NOT
CLAIM`. Both are load-bearing; do not trim either to make the opening punchier.

### 3.4 Category

```
Social Networking
```

- [ ] Selected. If the console's list differs, **News & Weather** is the runner-up. Do **not**
      pick *Privacy & Security* — this extension transmits browsing addresses, and filing it
      under a privacy category invites exactly the comparison it loses.

### 3.5 Language

```
English (United States)
```

- [ ] Selected.

### 3.6 Screenshots — the likely blocker, and it is already fixed

Requirement: **1280×800 or 640×400**, PNG or JPEG, no alpha channel, at least one, at most five.

Upload all five from `/home/hzia/repos/parle/store/screenshots/`, **in filename order**:

| # | File | What it shows |
|---|---|---|
| 1 | `01-the-discussions-beside-the-article.png` | The in-page discussion panel on a real Wikipedia article — live Hacker News Discussions and their comments. |
| 2 | `02-what-parle-sends-before-anything-is-looked-up.png` | The first-run screen, question unanswered. **This is the disclosure**, and second in the carousel is where a reviewer meets it without scrolling. |
| 3 | `03-the-mark-and-its-count.png` | The whole of what Parle draws on a page: one 32px mark carrying a count. The emptiness of the rest of the frame is the message. |
| 4 | `04-where-parle-asked-and-what-each-answered.png` | The toolbar popup: every place asked and what it answered on that run, with X **not asked — not in this build**. |
| 5 | `05-a-digest-that-cites-what-it-came-from.png` | A Digest, three Findings, each with a followable citation into the comment it came from. |

- [ ] All five uploaded, in that order. Verified 1280×800, 8-bit, no alpha.

Do **not** upload anything from `apps/extension/.e2e-shots/` — those are the design-review shots
at 1280×900, 360×457 and 128×128, and the store rejects all three sizes.

### 3.7 Store icon

- [ ] Upload `/home/hzia/repos/parle/store/icons/128.png` (128×128). Required; the tab will not
      accept a submission without it.

The same mark now also ships *inside* the package, which it did not before — the toolbar showed a
generic tile. Step 2.2's check confirms the four sizes are in the manifest.

### 3.8 The 2015 promotional tiles — replace or delete, do not leave

The existing tiles read **"INTRODUCING — A NEW WAY TO BROWSE THE WEB"** and describe a product
that no longer exists. On a listing under review that is a misrepresentation risk for no benefit.
Neither tile size is required to submit, so deleting them is a perfectly good answer.

- [ ] Small tile 440×280 → `store/small-promo-tile-440x280.png` (or delete)
- [ ] Marquee 1400×560 → `store/marquee-promo-tile-1400x560.png` (or delete)

### 3.9 The URL fields

| Field | Paste | Note |
|---|---|---|
| Homepage / Official URL | `https://ziahamza.com/parle` | **Clear `parle.co` first.** You no longer control that domain; pointing a listing at a domain you do not own is a misrepresentation risk and cannot be verified. |
| Support URL | `https://ziahamza.com/parle/support` | Public help, troubleshooting and contact page. |
| Privacy policy URL | see step 4.6 | **Mandatory**, because step 4.5's disclosures are non-empty. |
| YouTube video | leave empty | |

- [ ] `parle.co` cleared everywhere it appears.
- [ ] **Both URLs load.** The repository is public as of 18 August 2026, and
      `store/check-listing.mjs` now fetches every listing URL anonymously on a schedule, which is
      this check automated. Check in a logged-out browser window — a 404 on
      a listing URL is a rejection.

---

## 4. Privacy tab

This is where a submission of this kind is won or lost. Fill every field; the button stays grey
while any one is empty.

### 4.1 Single purpose

```
Parle's single purpose is to show the reader the public discussions that already exist about the web page they are currently viewing.
```

- [ ] Pasted.

### 4.2 Permission justifications

The console shows one box per permission it wants justified. **If a box does not appear for one
of these, skip it** — you cannot paste into a field that is not there.

- [ ] `tabs` → `listing.md` §2.2, block under **`tabs`**
- [ ] `scripting` → `listing.md` §2.2, block under **`scripting`**
- [ ] `webNavigation` → `listing.md` §2.2, block under **`webNavigation`**
- [ ] **Host permissions** (`http://*/*`, `https://*/*`) → `listing.md` §2.2, the long block under
      **Host permissions**

The host-permission answer is the one a reviewer will actually read. It does not minimise: it
says there is no shipped list of already-discussed pages, so the extension must be able to act on
whatever page the reader is on, then names the three concrete uses and states what the permission
does *not* do.

### 4.3 Remote code

- [ ] Answer **No, I am not using remote code.**
- [ ] If a justification box appears → `listing.md` §2.3.

Verifiable, and worth knowing you can defend: the shipped package contains **zero** occurrences
of `eval(`, `new Function(`, `importScripts`, an external `<script src>`, or a sourcemap
reference.

### 4.4 Data usage — tick exactly three

| Category | | Why |
|---|---|---|
| **Web history** | ✅ | The address of nearly every page the reader opens is transmitted to Hacker News and Reddit. This is the disclosure the whole submission turns on. **Do not leave this unticked under any reasoning.** |
| **Website content** | ✅ | On Hacker News, Reddit and X the content script reads links, thread ids, scores and comment counts from the page the reader is already on. When they press summarise, comment text is fetched and sent to their own AI Provider. |
| **Authentication information** | ✅ | If the reader connects an AI Provider, their API key is held in extension storage and sent to the endpoint they configured. It is a credential the item handles, so it is declared. |

Leave the other six unticked. `listing.md` §3.1 has the sentence to give for each if a reviewer
asks — read it once now so the answers are yours rather than a file's.

> **One thing to know before you tick "Authentication information":** ADR 0014 says the listing
> needs no such disclosure, and that is correct *about Network logins* — Parle holds no Hacker
> News, Reddit or X token and builds no OAuth flow. The tick is for the reader's own **AI
> Provider API key**, which is a different credential and is genuinely handled. Over-disclosure
> is the safe direction; this is not a contradiction, and if it is raised, that is the answer.

- [ ] Three ticked, six left alone.

### 4.5 The three certifications — all three, or the button stays grey

- [ ] I do not sell or transfer user data to third parties, apart from the approved use cases
- [ ] I do not use or transfer user data for purposes unrelated to my item's single purpose
- [ ] I do not use or transfer user data to determine creditworthiness or for lending purposes

The first one is the one that looks wrong and is not: sending the address to Hacker News and
Reddit **is** the single purpose, not a transfer outside it — there is no way to find out whether
a page was discussed without asking. The other recipient is the AI Provider the reader chose,
configured and clicked. There is no advertising, no broker, and no server of ours anywhere.
`listing.md` §3.2 has the full defence for each.

### 4.6 Privacy policy URL — mandatory

The policy is written and ready at `/home/hzia/repos/parle/store/privacy-policy.md`. It has to be
**reachable at a public URL before you submit** — the store fetches it.

1. Commit and push, then use the blob URL:
   `https://ziahamza.com/parle/privacy`
2. Or enable GitHub Pages and serve it as HTML — nicer to read, and it survives a branch rename.

- [ ] URL pasted, and it loads in a logged-out window.
- [ ] It is **not** `parle.co`.

---

## 5. The five-minute dry run — do this before you press submit

The reviewer will do exactly this. Load `/home/hzia/repos/parle/apps/extension/.output/chrome-mv3/`
unpacked into a clean profile (`chrome://extensions` → Developer mode → Load unpacked).

- [ ] The first screen opens on install, headed **"What Parle sends"**, offering **"Look pages up
      automatically"** and **"Only when I ask"**, and showing *"Not chosen yet. Nothing is being
      looked up."*
- [ ] Nothing is requested before you answer it. (DevTools → the service worker → Network.)
- [ ] `https://en.wikipedia.org/wiki/Antikythera_mechanism` produces a mark, and clicking it
      opens the panel with real Hacker News submissions.
- [ ] A page nobody has discussed adds **nothing** to the DOM — not an empty panel, nothing.
- [ ] The toolbar button on **`proton.me`**, **`coinbase.com`**, **`bsky.app`** and
      **`outlook.office.com`** — check what it says for each.

That last one is not optional. `research/ticket-03.md` §7 records those exact domains as ones the
best available skip lists are measurably missing, and notes that reviewers at both stores test
them. If one of them is *not* skipped, that is not a listing defect and it does not contradict
anything we wrote — the listing and the product both say the list is incomplete — but you want to
find it before a reviewer does.

---

## 6. Submit

- [ ] Re-read **"Why can't I submit?"**. If it is now empty, press **Submit for review**.
- [ ] If it still names something, and that something is not in steps 1–4 above: **copy the text
      verbatim and send it back.** Do not guess at it.

### What to expect

- The item goes to **Pending review**. Google's guidance is that most reviews finish within a
  day; items requesting broad host permissions routinely take longer, and there is no published
  SLA. A previously taken-down item re-entering the store is likelier than average to get a human
  looking at it. Days, not hours, is the sane expectation.
- **The decision arrives by email, at the publisher contact address** from step 1. Check spam.
- A rejection email names the policy it is about, often as a colour-and-element codename
  ("Blue Argon" and similar). The codename maps to a numbered section on the Program Policies
  page; the paragraph underneath is what you actually answer.
- Rejection is not the end — the console offers a reply/appeal path, and the material to answer
  with is already written: §2.2 for permissions, §3 for data use, §4 of `listing.md` for where
  every claim in the listing comes from.
- **Do not "fix" a rejection by narrowing the disclosure.** Everything the listing admits is also
  said inside the product; softening the listing to pass review would break the thing that makes
  the submission defensible in the first place.

---

## 7. What we are asking a reviewer to accept

Read this before you submit, so nothing in the reply surprises you.

**1. Broad host permissions on an extension that sends third parties the address of nearly every
page you read.** That is, mechanically, the shape of the extensions that got removed — WOT (2016),
Stylish (2018), Avast/AVG (2019, and a $16.5M FTC order in 2024). We are not claiming to be a
different mechanism. We are claiming to be on the right side of the specific line the record
draws, and the argument has four parts, all checkable:

- The disclosure is prominent **in the listing and in the product's own UI**, which is literally
  what Chrome's Limited Use policy requires — and the 2026 revision, whose enforcement began
  1 August 2026, is what made the UI half mandatory rather than nice.
- **Nothing is sent until the reader answers the first-run question.** Enforced in code, and the
  test suite asserts it against what actually went out on the wire.
- The fragment is never sent, tracking parameters are stripped, and there is **no server** — this
  project runs none, so nothing accrues anywhere for anyone to lose.
- The source is public and AGPL-3.0-only, so every sentence above is a thing a reviewer can check
  rather than a thing they have to believe.

**2. A content script on `x.com` in a listing that names only Hacker News and Reddit.** This is
the discrepancy a reviewer notices, and it is the easiest one to answer, because **X is compiled
out of this build.** `__PARLE_X__` is folded to `false` at build time, so the branch that would
query X is not disabled — it is *absent from the shipped file*. Grep the package and there is no
X endpoint in it. What the content script does on `x.com` is read the links already on the page
the reader is already looking at, and keep those pointers locally. **It sends X nothing.**

That materially simplifies the permission story and it is worth saying out loud: no X
credentials, no X requests, no X quota, nothing to justify. It is stated in the description
("X is not in this build at all"), in the host-permission justification, in the privacy policy
§1.3 — and the extension says it *itself*, on the first-run screen and the settings page, in a
sentence generated from the build flag rather than typed by hand: *"In this build, the code that
would ask X is not included at all, so it is Hacker News and Reddit that see the addresses of the
pages you read."*

**3. That we tick "Web history" and still claim Limited Use compliance.** That is exactly what
Limited Use permits: collection of browsing activity *to the extent required for a user-facing
feature described prominently on the store page and in the product's UI*. Finding the discussion
of a page requires sending the page's address. There is no version of this product that does not.

**4. And three things we are NOT asking them to accept**, because we never claim them —
`research/ticket-03.md` §7 lists them as unsupportable, and the description, the privacy policy
and the extension's own settings page all state them as refusals, verbatim:

- not "your browsing is private";
- not "we exclude addresses carrying credentials";
- not "we protect sensitive categories".

The bet is that a reviewer who opens the extension finds the interface saying the same thing as
the listing. That is the whole submission.

---

## 8. Afterwards — pinning the extension key for local development

**Not needed for the store. Skip this until you are back at the keyboard.**

The store holds the key pair for `bbigpojahnmkdbdnbcmadnhbjlemibom` and assigns the extension id
from its own copy. The uploaded zip contains **no `key` field**, which is correct, and step 2.2
verifies it.

The reason to pin one is the other direction. An **unpacked** build loaded from disk gets an id
derived from its *directory path*, so your local Parle is a different extension with a different
id. One thing in this codebase cares: the Codex Provider's "Log in with ChatGPT", whose only
available shape for a Chrome extension is `identity.launchWebAuthFlow` against
`https://<extension-id>.chromiumapp.org/` (ADR 0014). That redirect is **derived from the id**, so
a flow registered for the published id cannot complete against a local build with a different
one. Pin the key and the local build *is* the published id.

**You cannot derive the key from the id.** The id is a truncated hash of the key rendered in
a–p; it does not invert. The console is the only source.

**Getting it:** Developer Dashboard → the item → **Package** tab → **"View public key"** (it sits
behind the tab's overflow/more control in the current console). Chrome shows a PEM block.

**Using it** — one command, nothing committed:

```bash
cd /home/hzia/repos/parle
PARLE_CHROME_KEY='-----BEGIN PUBLIC KEY-----
MIIBIjANBgkq...            ← the whole block, newlines and armour included
-----END PUBLIC KEY-----' pnpm --filter @parle/extension build
```

`apps/extension/wxt.config.ts` strips the PEM armour and the newlines for you, and throws with a
readable message if what you pasted is not base64 — a private key, a `.crx`, or a fingerprint all
fail loudly instead of silently producing an extension under the wrong id.

If you would rather not retype it each time, paste the same block into `PUBLISHED_PUBLIC_KEY` at
the top of that file. **Then remember it is in the file**, and rebuild without it before making a
store zip. Passing it per-command is the better habit precisely because a key that is never in
the file can never be in the upload.

It is applied on the **Chrome** build only. Firefox derives its id from
`browser_specific_settings` and Safari from the containing app's bundle id; `key` means nothing to
either, and both were checked — a Firefox or Safari build with `PARLE_CHROME_KEY` set emits no
`key` field.

One honest note so this does not confuse you later: **pinning the key will not by itself make
"Log in with ChatGPT" work.** `packages/provider/src/Codex.ts` implements the client — the request
shape, the headers, the SSE decoding — and deliberately does *not* implement token acquisition,
because the flow is unresolved across Chrome and Safari (Safari has no `browser.identity` at all).
The key removes one obstacle that would otherwise appear at the very end. It does not remove the
others.

---

## 9. Regenerating anything in this package

```bash
cd /home/hzia/repos/parle

# the package, and the store zip
pnpm typecheck                                    # 20/20
pnpm --filter @parle/extension build              # → .output/chrome-mv3/
pnpm --filter @parle/extension exec wxt zip       # → .output/parleextension-<version>-chrome.zip
cp apps/extension/.output/parleextension-*-chrome.zip store/parle-chrome-store.zip

# the five screenshots, from the real extension in a real Chrome (~4 min, needs a live network)
pnpm --filter @parle/extension e2e:store          # → store/screenshots/*.png

# the two promo tiles and the icons
pnpm tsx store/make-art.ts
```

The build is deterministic: rebuilding and re-zipping an unchanged tree reproduces the same
sha256 as step 2. So if the checksum comes out different, something in the tree changed — which
is worth a look before you upload, not after.

The screenshot run prints what each service actually answered, and lists anything that went
wrong under `LOOK AT THESE BEFORE UPLOADING`. **If it prints nothing under that heading, the five
files are good.**

Never `zip -r` the output directory. That produces an archive with everything under a
`chrome-mv3/` folder and the store rejects it with *"manifest file is missing or unreadable"* —
the old `.output/parle-chrome.zip` had exactly that shape and has been deleted so it cannot be
uploaded by mistake.

---

## 10. Everything in this package

| Path | What it is |
|---|---|
| `store/parle-chrome-store.zip` | **The upload.** MV3, v3.0.1, 21 files, manifest at root, no pinned key. |
| `store/SUBMIT.md` | This file — the procedure. |
| `store/listing.md` | The reference: every console field's full text, and §4, which maps each claim in the listing to the ADR, research file or test behind it. |
| `store/privacy-policy.md` | The policy the URL in step 4.6 must point at. Push it before you submit. |
| `store/screenshots/*.png` | Five, 1280×800, in upload order. |
| `store/icons/128.png` | The store icon. |
| `store/small-promo-tile-440x280.png` | Replaces the 2015 small tile. |
| `store/marquee-promo-tile-1400x560.png` | Replaces the 2015 marquee. |
| `store/make-art.ts` | Generates the tiles and icons. |

Two known caveats, neither blocking, both worth a decision rather than a discovery:

- **Screenshot 5's Digest was written by a local stand-in**, not a real Provider — there is none
  on this machine. The stand-in cannot invent: it quotes the comments' own words and cites the
  comment each came from, so every sentence on that frame was written by a person on Hacker News
  and every citation resolves. What is standing in is the summarising, not the material. If you
  have an API key or a ChatGPT subscription, reshoot that one frame. If not, it is defensible.
- **Reddit answers "refused us" in screenshot 4** because this machine has no Reddit session, and
  Reddit returns 403 without cookies. It is honest, and arguably the better frame: it shows the
  product accounting for a refusal instead of hiding one. On a machine signed in to Reddit the
  same shot would show results. Your call.
