# Parle

See what Hacker News and Reddit have already said about the page you are reading. Parle finds the discussions, shows a small mark when there are any, and — once you connect an AI Provider of your own — summarises what those conversations actually said, with a followable link under every claim. No account, no server of ours, and it tells you before it sends anything anywhere.

It is a Manifest V3 WebExtension targeting Chrome, Safari (macOS and iOS) and Firefox from one codebase. It works with no account, no server of ours, and no AI connected; each of those is an upgrade rather than a requirement.

**Picking this up?** [HANDOFF.md](HANDOFF.md) is the full brief: verified state, how to run the
end-to-end battery, what is blocked on a human, where this is heading, and the traps that already cost
someone a day.

**Status: early. Hacker News works end to end. Read [What Parle sends, and to whom](#what-parle-sends-and-to-whom) before you install it, and [What is not built](#what-is-not-built) before you rely on it.**

---

## The first thing it does is ask

On install, Parle opens one page and asks a question with two answers: look pages up
automatically, or only when you click the toolbar button. It is under a hundred words — where
the address goes, by name; that the skip list is a list and will miss things; and which of the
three sites this build cannot contact — with the long version one link away on the settings
page. Until that question is answered **no address leaves your browser at all**, on any page,
whatever else is configured.

That is enforced rather than promised. The reader's answer is a field in the settings document;
`Choices.choicesOf` in `apps/extension/src/policy/Choices.ts` reports manual mode until it
exists, and `LookupPolicy` reads that on every automatic decision. Close the tab unread and you
get an extension that looks nothing up and says so on every page. `src/app/FirstRun.test.ts`
asserts it on what actually went out on the wire, not on what the screen said.

Either answer leaves the toolbar button working on every page. ADR 0005 requires that it never
says "not applicable".

---

## What Parle sends, and to whom

Parle sends the address of the page you are reading to Hacker News and Reddit, to find out whether anyone has discussed it. The page's title is not sent — it is used on your machine to label what you are reading. That is the same thing as pasting the link into their search boxes — it is not anonymous, and those services see it.

It does this automatically on most pages. It does **not** do it on pages that match a built-in exclusion list — banks, webmail, AI chats, adult sites, government sites, social feeds, and private or internal addresses — or on pages whose address visibly contains a token or credential. It never sends the part of an address after the `#`, and it strips tracking parameters before sending.

That exclusion list is a list. It is incomplete, and it will miss things, including services we have not heard of and short share links that look like ordinary addresses.

Three things this project will not claim:

- Not *"your browsing is private."* It is not. Every non-excluded page you read produces requests to third parties carrying that page's address.
- Not *"we exclude URLs carrying credentials."* The rules catch several common shapes. Short share-tokens that look like ordinary path segments are undetectable in principle.
- Not *"we protect sensitive categories."* A domain list cannot cover health, internal corporate tools, or documents, and the best available lists are measurably missing well-known providers.

### Precisely what leaves your machine

| Where | What is sent | Credentials |
|---|---|---|
| `hn.algolia.com` | the canonicalized address (up to 4 alias forms) — **not** the title | none — no cookies, no key, no account |
| `www.reddit.com`, then `old.reddit.com` if that is refused | the canonicalized address — **not** the title | **your Reddit cookies** on the first attempt (`credentials: "include"`), because Reddit answers `403` without them. The fallback is cookie-free. |
| A link shortener — `t.co`, `bit.ly` and the like — **only while you are on Hacker News, Reddit or X, and only once you have answered the first-run question with "yes"** | a `HEAD` (then one `GET` if that is refused) for a shortened link *that was on the page you were already looking at*, to find out where it goes. Nothing about any other page you have read. Capped at 150 requests an hour, deduplicated per page, and cached. | none |
| X | nothing. The code that would ask X is compiled out of this build. | — |
| `hn.algolia.com/api/v1/items/…`, `www.reddit.com/comments/….json` — **when you open a discussion, and when you press "Summarise these discussions"** | opening a discussion asks for that thread's comments, because the comments are what the panel shows; summarising asks for up to six. Never on a page load, and never for a page whose panel you did not open. | none for Hacker News; **your Reddit cookies** for Reddit, as above |
| **Whatever AI Provider you connected**, if you connected one — your own API key's endpoint, or nothing at all if you chose your browser's built-in model | **only when you press "Summarise these discussions"**: the page's address, and the text of the comments just fetched. This is the largest thing Parle ever sends anywhere, and it is the only thing that never happens without a click. | your own API key or token, which you pasted |
| Any server run by this project | nothing. There is no backend. The one project-hosted request is a daily static skip-list update from this repository — identical for every install, carrying no cookies and no addresses. | — |

**Two things are written to your disk, and they are different in kind.**

- **Your settings.** One entry, `parle/settings/reader`, because a setting that dies with the service worker is not a setting. **If you connect an AI Provider with an API key, that key is in this entry, as ordinary text.** A browser extension has no keychain — MV3 gives it nothing better than the store any other setting goes in — so anything that can read your browser's profile can read the key. The settings page says so where you paste it. Use a key you can revoke.
- **What Hacker News, Reddit and X showed you.** When you are on one of those three sites, Parle records the links on the page you are looking at, along with which thread each came from and its score and comment count. That is the **local discussion cache**, and it never leaves your machine. It is why a link you click on Hacker News already has its thread attached before the page finishes loading — with no request to anyone.

Both live in a Cache store named `parle`. You can see the whole of it yourself: open the extension's service worker console and run `caches.open("parle").then(c => c.keys()).then(k => k.map(r => r.url))`. Everything under `parle/recollection/` is the cache; there is one key under `parle/settings/`.

**What is deliberately NOT written there is anything derived from a lookup.** The distinction is the entire argument. A cache built by harvesting holds links that were on pages you had already opened — it discloses nothing we did not already see. A cache built from *lookups* would be a dated record of every page you visited, sitting on your disk. So the two halves are separated in the code rather than by convention: the harvest half is given a store that can write, the lookup half is given one whose writes stay in memory and die with the service worker. `apps/extension/src/harvest/LocalCache.ts` is the seam, and `src/harvest/Harvest.test.ts` asserts it on the actual bytes in the store.

The cache is bounded at 4,000 entries — roughly a few megabytes — and evicts the oldest harvest first. The bound is sized for Safari on iOS, which is the tightest of the three platforms.

**"Forget everything" clears both the cache and the lookup record.** The finer control clears the lookup record alone, and deliberately leaves the cache: it was never a privacy liability, and it is expensive to rebuild.

Parle does not read the content of the pages you visit. It uses the address, and the tab title which the browser gives the extension directly and which never leaves your machine. On Hacker News, Reddit and X it reads the page's own markup — the links, thread ids, scores and comment counts that are on your screen — and keeps only those pointers and numbers; the markup itself is read once and discarded.

The manifest asks for three permissions — `tabs`, `scripting` and `webNavigation` — plus `http://*/*` and `https://*/*`. `scripting` is what injects the mark, and it runs only on pages where there is something to show. **One content script is in the manifest**, on `news.ycombinator.com`, `reddit.com` and `x.com` and nowhere else: it is the harvester, and being present on those three sites is the whole of how the cache gets filled. It reads on idle, never while the tab is in the background, and at most once every four seconds. `storage` is deliberately not requested.

### What limits the sending, today

- **The first-run question.** Nothing automatic happens until it is answered, and answering
  "only when I ask" means nothing automatic ever happens. Answering "yes" is permission for
  what you open next; it does not retroactively look up the pages already sitting in your
  background tabs. **This covers harvesting too**, which is worth saying because the harvester
  is the one part of Parle that is in the manifest and therefore starts as soon as the
  extension is installed: until you have answered, opening Hacker News, Reddit or X records
  nothing and resolves no shortened link. A site you have paused is likewise not harvested.
- **Only the tab you are looking at.** Pages loading in background tabs, links opened to read later, and session restore produce no requests. This is a stand-in for a shipped offline prefilter that does not exist yet; it is not the final design.
- **The local discussion cache answers first, and for free.** Every page consults your own machine before any network request is made. On a page you already have a thread for, the panel is populated before anything leaves the browser.
- **One Reading per navigation.** A redirect chain — a `t.co` hop, a consent interstitial, then the article — settles into a single Reading at the destination, so one click is one Lookup, not four.
- **Top frame only.** An embedded video or an ad iframe never becomes a page we ask about.
- **Pacing.** Requests to each service are rate-limited per question, harder for Reddit than for Hacker News, because Reddit's budget is shared with your own use of Reddit in other tabs.
- **A per-worker-lifetime budget** of 120 Lookups per network per question.

### What you can change, and where

- **From the first-run page**, and from the toolbar button at any time afterwards: automatic
  lookups on or off.
- **From the toolbar button, and from the panel on the page**: pause Parle on the site you are
  looking at, and start again.
- **From the toolbar button, when Parle has decided not to look a page up**: the reason, in
  plain words — including which rule of the exclusion list fired — and one click to look it up
  anyway.
- **From the settings page**: the whole of the above, plus the reader's own exclusions and
  allow-anyway entries, the per-Network switches, and the two controls that throw away what
  this device remembers. It also carries the long version of the disclosure — the three claims
  above that this project refuses to make, and what is true of this particular build — behind
  one click, which is where the first-run screen's own link lands.

Switching a network off stops it everywhere, not just at the point of asking: no lookup is
issued, and nothing that network said is drawn out of the local discussion cache either. A
switch that still showed you Reddit threads it had already collected would read as broken.

The bundled exclusion list itself is still a build artifact: adding an entry of your own is a
setting, but changing what ships means editing `packages/policy/src/Seed.ts` and rebuilding.

---

## What works today

Loading a page produces this, for real:

1. `@parle/browser` notices the navigation, settles the address, and enforces top-frame-only.
2. `@parle/policy` canonicalizes it into a Subject URL and decides, per network and per question, whether to ask — recording a reason whenever it declines.
3. Your own machine answers first, from the local discussion cache, with no request. If you got here by clicking a link on Hacker News, Reddit or X, the thread is usually already there.
4. `@parle/networks` asks Hacker News through the Algolia search API, re-checks every hit's own submitted URL against the page's aliases, and classifies whatever comes back.
5. Coverage accumulates: every place we turned, and exactly what came back from each.
6. The toolbar badge updates, and a small mark is injected into the top right of the page **only if there is something to show**. On a page with nothing, no node of ours is added to the page at all — `puts nothing at all on a page nobody has discussed` in `e2e/parle.e2e.ts` walks every shadow root in the document and expects to find none.
7. Clicking the mark opens the panel on the page: the discussions themselves, grouped, and the Digest. Clicking the toolbar button shows the status instead — what happened at every place asked, including the ones that refused and the ones we chose not to ask.

The Hacker News connector is real, not mocked; it is keyless and CORS-open, so it genuinely works from a browser with no setup. Reddit is real code but returns `403` from most datacenter IPs, which the toolbar reports as a refusal rather than as "nothing found" — that distinction is deliberate and load-bearing.

### Two surfaces, and why the account is on the toolbar

The mark appears only where there is something to read, so the panel it opens goes straight
into the conversations. Everything about *us* — what refused, what was not asked and why, and
the switch that decides it — is behind the toolbar button, which is reachable on every page
including the overwhelming majority where nothing was found and nothing was injected. Moving
the account there makes it more reachable, not less; what it stops doing is competing with the
discussions on the pages that have some.

Hacker News takes a popular article several times. Repeat submissions nobody replied to are
folded into a clause on the thread that has the replies — *also submitted 3 times* — and a
posting with any comments at all is never folded away.

### An empty panel always means something specific

ADR 0011 makes every degraded capability a *state* the surface renders rather than an error it
throws, and there is no arrangement of either surface that draws nothing. Everything down to
*the reader has not answered the first-run question* is said under the toolbar button; the
Digest rows below it are said in the panel on the page, which is where the Digest is. Each with
its own words:

| What is true | What the reader is told |
|---|---|
| Some services have answered, others have not | *Still looking*, naming which — they answer in waves and at very different speeds |
| Everyone answered, nobody had anything | *Nobody has discussed this page* |
| Nobody answered at all | *Parle could not find out* — deliberately not the same sentence, because it is the opposite fact |
| Reddit or X refused, is rate-limiting, or needs a sign-in | Which one, and which of those it was — never the word "unavailable", which says none of it |
| An answer came back unreadable | Said as its own thing, never folded into "nothing found" |
| The page is on the exclusion list | Which rule fired, in the reader's words, plus one click to look it up anyway |
| The address is not a public web page at all | Said plainly, with no button — there would be nothing to look up |
| Automatic lookups are off | Distinguished from *we* switched something off, which reads differently |
| The reader has not answered the first-run question | Where the address would go, that nothing has been sent, and a way back to the question |
| No Provider is connected | *No Provider connected*, as the ordinary case ADR 0004 makes it, not a failure, plus one click to the settings page |
| A Provider is connected and you have not asked for a Digest | Exactly what pressing the button would fetch, how many discussions that is, and where the comments would be sent — before anything is sent |
| A Digest is being written | That the comments are being read and which Provider is being asked |
| Your key was rejected, or the account cannot pay, or the Provider asked us to slow down | Three different sentences and two different offers — the settings page for the first two, "try again" for the third |
| The model answered and nothing it wrote could be traced to a comment | Said as that, and not as your model being bad at its job |
| The model died mid-answer | The Findings that did arrive, marked as part of an answer — never a discarded Digest |
| No comments could be read at all | That nothing was sent to your Provider, so nothing was spent |
| No offline list of already-discussed pages ships | That every non-excluded page you open is therefore asked about — a fact with a cost |
| The offline list is out of date | That this costs a little speed and **not** results, because a list can only ever save a request |

`src/view/render.test.ts` draws every one of those and asserts two things over the finished
DOM: that each puts words on the screen, and that no term from `CONTEXT.md`'s engineering
vocabulary reached the reader.

### Digests: summaries of the conversation

Finding discussions needs no AI and never will. A **Digest** — a set of attributed statements
about what those discussions actually said — needs a model, and you supply it. ADR 0004 draws
the free/paid line at exactly that point, so an install with nothing connected is a complete
product rather than an upsell wall.

**Connecting one.** The settings page offers three, and exactly one is active:

- **An API key of your own.** Anything speaking the OpenAI chat-completions shape: OpenAI
  itself, a `llama.cpp` server on `http://localhost:8080/v1`, or another vendor. This is the
  one that is contractually reliable — it keeps working because of your agreement with whoever
  issued the key, not because of ours with anyone.
- **Your browser's built-in model.** No key, no account, and the comments never leave the
  machine. Offered only when the browser really has one downloaded; Safari has none at all.
- **ChatGPT.** The client is written and the request shape is right, but there is **no sign-in
  flow** — ADR 0014 leaves it unresolved and Safari has no `browser.identity` — so this takes a
  token pasted from elsewhere, behind a seam the settings page labels as the rough edge it is.

**Asking for one.** Building a Digest means fetching the *comment bodies* of the discussions on
the page — far more traffic than the lookups that found them — and then sending that text to
your Provider. So it never happens on its own. The panel shows the sentence first:

> Parle will read the comments of 3 discussions and send them to your own API key to be
> summarised. It has not done that yet.

and only a click on **Summarise these discussions** sends anything to a Provider. Comments
themselves arrive earlier — opening a discussion fetches that thread's comments, because they are
what the panel shows. Two tests hold the part that matters on the requests that actually left
rather than on what the screen said: `src/ai/Digest.test.ts` at the seam, and
`src/app/Summarise.test.ts` through the whole shipped graph — a navigation, a settled panel, and
not one comment fetched before the reader opened anything.

**Every Finding cites a comment, and the citation is a link you can follow.** ADR 0006 lets a
Digest report a claim as *disputed* — the only judgement it makes, and always someone else's —
on one condition: that you can go and read the objection yourself. So a disputed Finding that
points at a whole 640-comment thread is discarded rather than shown, and every source rendered
is an anchor to the specific comment. The disputed mark is styled as a report about the
conversation rather than as a warning, because "contested" reads as "false" to most people and
ADR 0006 names that as the risk.

None of this is trusted. Every object the model produces goes through `@parle/domain`'s
`admit`, which requires the Brief as a *decoding service* — you cannot decode model output
without producing the material it was supposed to have been reading — so a Finding citing a
discussion that was never fetched cannot be constructed at all. A model that invents a source
*and* a citation naming it still fails, which is the failure that motivated the design.
`{ disableChecks: true }` appears nowhere in the repository.

A Digest is written to disk nowhere and sent to no server of ours. It is stamped with which
Provider and model wrote it, and the panel says so.

## What is not built

| Thing | State |
|---|---|
| **Digests** (AI summaries) | **Wired**, for a Provider you connect yourself on the settings page: an OpenAI-compatible API key (which also covers a model running on your own machine), or Chrome's built-in model where there is one. Nothing is fetched and nothing is sent until you press the button in the panel — see [Digests](#digests-summaries-of-the-conversation) above. What is *not* built: any sign-in flow. "Log in with ChatGPT" takes a token pasted from elsewhere, because ADR 0014 leaves the flow unresolved and Safari has no `browser.identity` at all. Shared Digests — written by us for popular pages and served to readers with no Provider — need a backend, and there is none. |
| **X** | Compiled out (`__PARLE_X__ = false`). The connector is written and the gate that would govern it is enforced, but the endpoint research is unresolved and it is your own X account at risk. |
| **The Discussion Index** | Codec built, index not. `@parle/index-codec` exists and is tested — one 4 MB binary fuse filter, no sharding — but nothing builds or serves an actual index, and it is not wired in. The "only the tab you are looking at" restraint above stands in for it, and the toolbar says in so many words that without it every page you open is asked about. |
| **Harvest** | **Wired.** A content script on Hacker News, Reddit and X hands each page to `@parle/harvest`, which keys every link on the address it actually resolves to and writes the result to disk — once you have answered the first-run question with "yes", and not on a site you have paused. What is *not* built is ADR 0012's second filler, opportunistic prefetch — nothing pulls a front page you did not open, and nothing runs on a schedule. |
| **Suppressing a lookup on a cache hit** | **Deliberately not built.** ADR 0012 originally said a cache hit needs "no Lookup at all"; that was wrong and has been struck. The cache is filled by harvesting, so it holds only what you happened to *see* — the one thread you clicked from, not the other four about the same page. Skipping the lookup would show one discussion and silently hide the rest. So the cache paints first, with no request, and the lookup still runs behind it: you get the speed without losing the results. |
| **Reading the bundled exclusion list** | The settings page shows your own entries and overrides; it does not yet list the ~24,000 bundled domains for you to browse. |
| **The kill switch** | Reads as "no reason to stop". There is no backend to fetch a manifest from. |
| **Passing Mentions** | **Produced.** A Hacker News or Reddit *comment* page yields them: an address inside a comment on a thread about something else. They render in their own group, never blended with the strong tier, and they do not open the X gate. No *lookup* produces one — no connector searches comment bodies — so they come from harvesting alone. |

---

## Build it

You need **Node 24 or newer** and **pnpm 9.12** (the version is pinned in `package.json`; `corepack enable` will pick it up).

```bash
git clone <this repo> && cd parle
pnpm install
pnpm --filter @parle/extension build
```

The loadable extension is written to `apps/extension/.output/chrome-mv3/`.

Other targets:

```bash
pnpm --filter @parle/extension exec wxt build -b firefox   # apps/extension/.output/firefox-mv3
pnpm --filter @parle/extension exec wxt build -b safari    # apps/extension/.output/safari-mv3
```

All three are Manifest V3. Safari's build still needs Xcode or an App Store Connect upload to become an installable app; see ADR 0003.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Choose `apps/extension/.output/chrome-mv3`.

A tab opens with the disclosure and the one question. Nothing is looked up until you answer it;
if you dismiss it, the toolbar button will tell you so on every page and offer a way back. You
can reopen it later from **What Parle sends** under the toolbar button.

Then visit a page that has been discussed — for example:

```
https://www.nature.com/articles/d41586-024-02012-5
```

Within a second or two the Parle toolbar icon shows a count, and a small round mark appears at the top-right of the page carrying the same count. Click the mark to open the panel — docked to the right on a wide window, full-screen with a close button on a narrow one, closed by Escape or its own button. It lists the Hacker News threads that submitted this exact address. (Threads matched by title used to be shown alongside; ADR 0020 deleted that search.)

Click the **toolbar button** instead for the status: every place asked and what came back from each — including Reddit refusing, and X saying it is not in this build.

A page nobody has discussed shows no badge, no mark, and nothing of ours on the page at all; the toolbar says so specifically rather than showing an empty list.

For live reload while developing:

```bash
pnpm --filter @parle/extension dev
```

### Latest main package, without building

CI publishes each successful `main` Chrome MV3 zip to the `qa/chrome-mv3-latest` branch — not to `main`. **Read `BUILD.txt` beside the zip before using it**: it records the commit, the package version, and the Node and pnpm that built it, and it is the only thing that tells you whether this heading's *Latest* is true right now. The branch is refreshed by a green `main` publish and by nothing else, so a run that failed leaves the previous zip in place with nothing to announce it. (`HANDOFF.md` §4 trap 8 is the time that cost someone the wrong build.) The `main` build does also upload a `parle-chrome-store-<sha>` Actions artifact, but that expires after 14 days and needs an Actions login; the branch is the durable copy, fetchable with the API, a raw URL, or a clone.

```bash
# GitHub API (raw bytes; no Actions login)
gh api -H "Accept: application/vnd.github.raw" \
  "repos/ziahamza/parle-extension/contents/parle-chrome-mv3.zip?ref=qa/chrome-mv3-latest" \
  > parle-chrome-mv3.zip

# same file via the contents API's short-lived raw URL
gh api "repos/ziahamza/parle-extension/contents/parle-chrome-mv3.zip?ref=qa/chrome-mv3-latest" \
  --jq .download_url | xargs curl -L -o parle-chrome-mv3.zip

# clone
git clone --depth 1 --branch qa/chrome-mv3-latest --single-branch \
  https://github.com/ziahamza/parle-extension.git parle-qa-zip
```

`BUILD.txt` on that branch records the source commit, package version, Node/pnpm, timestamp, and the exact `wxt zip` command. Unzip and **Load unpacked** — `manifest.json` is at the archive root. Do not open a pull request from that branch.

To rebuild and restage locally (writes `dist-qa/`, gitignored):

```bash
pnpm --filter @parle/extension exec wxt zip
pnpm publish:qa-zip
```

## See it work without a browser

The whole pipeline — navigation event through to a rendered panel — runs headlessly against the real Hacker News API:

```bash
PARLE_LIVE=1 pnpm --filter @parle/extension exec vitest run src/app/Pipeline.live.test.ts
```

That test substitutes only the WebExtension API. The canonicalization rules, the policy decisions, the connector, Coverage and the panel derivation are the ones that ship.

## See it work *in* a browser

Everything above substitutes the platform, and a Manifest V3 extension has failure modes that only exist in a real browser — a service worker that registers no listeners, a content script the page's CSP blocks, a permission that was never granted. This project shipped, briefly, in exactly that state: 860 passing tests and an extension that did nothing at all when you loaded it.

So there is a harness that loads the real build into a real Chrome:

```bash
pnpm e2e
```

It runs headed Chrome on a virtual display (Xvfb), with the extension loaded into a dedicated profile — never your own — and asserts on **what actually left the browser**: that Hacker News was asked, with the canonicalized address; that X was not; that a loopback address produced no request at all; and that nothing was asked before the first-run question was answered. Screenshots land in `apps/extension/.e2e-shots/`.

The full automated verdict belongs to GitHub Actions: `.github/workflows/ci.yml` runs quality, build,
package, browser, and torture jobs on every pull request and push to `main`. A successful `main` run
refreshes `qa/chrome-mv3-latest` (see [Latest main package, without building](#latest-main-package-without-building));
a failed run leaves the previous zip there, so check that branch's `BUILD.txt` rather than assuming.
Use local E2E only for a focused investigation; use a manually loaded unpacked extension for final
visual and interaction QA. The on-demand `Release readiness` workflow regenerates and audits the
store zip and screenshots.

Two things it does that are less obvious than they look, both learned the hard way:

- It **deletes the profile's service-worker registration before every launch.** Chrome keeps the background script it registered *in the profile*, and reloading an unpacked extension at the same version does not replace it — so a run can otherwise pass against code that no longer exists.
- It **fails at launch if nothing is listening**, rather than letting every check fail one by one with no explanation.

### Looking at it

A selector count says a thing was drawn; it does not say whether it was drawn well. There is a second run for that, which asserts nothing and photographs everything:

```bash
pnpm --filter @parle/extension e2e:shots
```

Every surface at **1280×900** and at **390×844**, light and dark, into `apps/extension/.e2e-shots/`. It also counts the words on the two prose screens from the rendered page rather than from a source file, and reports whether any of them scrolls sideways at phone width.

One thing in it is worth knowing about: the toolbar popup is opened with `chrome.action.openPopup()` and photographed through a second CDP client. Playwright's persistent context never adopts an extension popup as a page, so the popup used to be opened as a *tab* — which is 1280px wide, describes its own tab rather than the article's, and therefore never showed the account of every place Parle asked. Opened as a real popup it is 360px and describes the page the reader is on, which is both the surface that ships and the one where a footer that wraps onto two lines is visible at all.

---

## Repo layout

| Package | What it owns |
|---|---|
| `packages/domain` | The shared vocabulary as types: Subject, Mention, Coverage, the X gate, the Digest and its citation invariant. Stable Effect modules only — no HTTP, no storage, no browser. |
| `packages/browser` | The only place `chrome.*` appears. Tabs, navigation, storage, messaging, and the Reading boundary. |
| `packages/policy` | Canonicalization, the exclusion list, and the one seam that decides whether to issue a Lookup. |
| `packages/net` | The HTTP client, the token bucket, and the total classifier that turns a response into a Coverage outcome. |
| `packages/networks` | The Hacker News, Reddit and X connectors. |
| `packages/memory` | The local discussion cache, the lookup record, and opaque keying. |
| `packages/provider` | AI providers behind one interface. |
| `packages/digest` | Selecting what a Digest is written from, and holding the model's answer to it. |
| `packages/harvest` | Reading the Networks you are already on, and resolving `t.co`-style links to where they actually go. |
| `packages/index-codec` | The Discussion Index artifact format and its manifest. |
| `apps/extension` | The extension: the layer graph, the enquiry, the board, the panel, and the two surfaces. |
| `apps/site` | The landing page. One static HTML document built by Vite, and the stylesheet that carries the design language. |

`apps/pipeline` is an empty placeholder. `packages/digest` and `packages/index-codec` are built and tested but **not wired into the extension** — the behaviour described above is what ships without them, and the table under [What is not built](#what-is-not-built) says which is which.

`CONTEXT.md` is the project's glossary and is binding on names in the code. `docs/adr/` holds the architecture decisions; several of the rules above are enforcements of a specific ADR and say so in the source.

## Development

```bash
pnpm typecheck     # every package
pnpm test          # every package
pnpm build         # every package, plus the extension bundle and the site
pnpm dev:site      # the landing page on http://localhost:5173
```

### The design language

Parle has no house colour, and that is the load-bearing decision. Every surface
is a warm neutral, and the only colour anywhere in the product tells you which
network a thread came from: `#ff6600` for Hacker News, `#ff4500` for Reddit.
There was a blue accent until recently, and it was removed rather than
re-toned: on a list of Hacker News and Reddit threads, a third saturated colour
reads as a fourth network. Emphasis is bought with weight, size or a rule.

Every number is set in a monospace face. Points, comment counts, ages and the
address under the panel heading are all data, and setting them apart is what
lets a row of counts be scanned without a box drawn around it.

Three files hold it, and they must not drift:

- `apps/extension/src/view/styles.ts` is the source of truth for the tokens,
  and the long comment at the top is the reasoning. The extension uses system
  faces, because MV3 gives a content script no way to load a webfont that does
  not cost a request on every page a reader opens.
- `apps/site/src/site.css` is the same palette for the web, where the real
  faces are available: Archivo for anything a person reads, IBM Plex Mono for
  anything that is a number or a label. The site's demo panel renders Hacker
  News rows in Verdana with the grey subtext line, because that, and not a
  logo, is what makes a reader recognise the product in one glance.
- `store/make-art.ts` draws the icons and the store tiles from those same
  values, and the toolbar icon is the single documented exception to the
  no-house-colour rule. The comment there says why.


Tests that talk to the real internet are skipped unless `PARLE_LIVE=1` is set.

## Licence

**AGPL-3.0-only.** The full text is in [`LICENSE`](./LICENSE).

Every part of this repository is under it — extension, packages, tooling. The reasoning is in [ADR 0010](./docs/adr/0010-agpl-3.0-throughout.md): the asset worth protecting is the discussion index pipeline, and AGPL's network clause means anyone running a hosted fork has to publish their changes. You may deploy the whole stack yourself and point your own install at it; you simply cannot do so privately.
