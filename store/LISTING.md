# The listing — why it is not automated, and what is automated instead

The package ships itself. `.github/workflows/release.yml` builds it, audits it, uploads it and
submits it for review the moment `apps/extension/package.json`'s version changes on `main`. No
human touches the Developer Dashboard for a release.

**The listing cannot work that way, and it is worth being precise about why.**

## There is no API for any of it

Chrome Web Store API v2 (`chromewebstore.googleapis.com`) has exactly five methods:

| Method | What it does |
|---|---|
| `media.upload` | upload a `.zip` |
| `publishers.items.publish` | submit the uploaded draft for review |
| `publishers.items.fetchStatus` | what the store is holding, published and pending |
| `publishers.items.cancelSubmission` | withdraw a pending submission |
| `publishers.items.setPublishedDeployPercentage` | move a staged rollout |

That is the whole surface. There is **no** method for the description, the summary, the
screenshots, the promotional tiles, the category, the language, the URLs, the single-purpose
statement, the permission justifications or the data-use declarations. v1 had none either, and v1
is switched off on **15 October 2026** — so this is not a "use the older API" problem.

Those fields exist only in the Developer Dashboard, and the dashboard cannot be driven by a script
either: it is served from `chrome.google.com/webstore/*`, which Chrome forbids every extension
from scripting, and it sits behind a Google sign-in that re-prompts for a password and a second
factor. Browser automation against it is not a robust pipeline; it is a thing that breaks silently
and tells you during a review.

So: **updating the listing is a human pasting text into a form.** The honest thing is to make that
paste short, correct and rare, rather than to pretend otherwise.

## What is automated

`store/listing.json` is the repository's copy of every short field, and it names two files that
hold the long ones:

- `store/summary.txt` — the 132-character field, currently 123.
- `store/description.txt` — the description, currently 5,453 of 16,000 characters.

Both are **paste-ready**: no Markdown, no front matter, no trailing prose. Open the file, select
all, paste. `store/listing.md` remains the reference that explains *why* each sentence says what
it says; these two are what actually goes in the box.

`store/check-listing.mjs` audits all of it:

```bash
node store/check-listing.mjs            # includes the network checks
node store/check-listing.mjs --offline  # local only
```

- field lengths against the store's limits, and no Markdown in a plain-text field;
- the two load-bearing description sections (`WHAT IT SENDS, AND TO WHOM`,
  `THREE THINGS PARLE WILL NOT CLAIM`) are still present — a rewrite that drops either one stops
  satisfying Chrome's Limited Use prominence requirement;
- five screenshots, exactly 1280×800, no alpha channel, in carousel order, with slot 2 reserved
  for the disclosure frame;
- icon and both tiles present;
- **every URL fetched anonymously**, including any URL the description body points at.

That last one is the check that earns its keep. A listing URL that 404s is a rejection ground, and
it does not fail when it breaks — it fails weeks later, during a review, on a page nobody thought
to open logged out.

`.github/workflows/release-readiness.yml` runs the whole thing on a schedule, regenerates the five
screenshots from the real extension in a real Chrome, and uploads everything as an artifact. Drift
is therefore something you are told about, on a timer, rather than something a reviewer discovers.

## The paste, when it is needed

1. `gh workflow run release-readiness.yml`, or run it locally:
   ```bash
   pnpm --filter @parle/extension e2e:store
   node store/check-listing.mjs
   ```
2. Open <https://chrome.google.com/u/2/webstore/devconsole> → the Parle item → **Store listing**.
3. Paste `store/summary.txt` into **Summary** and `store/description.txt` into **Description**.
4. If the screenshots changed, replace all five, **in filename order** — slot 2 is the first-run
   disclosure screen, and second in the carousel is where a reviewer meets it without scrolling.
5. Confirm the three URLs still read as `store/listing.json` says.
6. Save. A listing-only edit still goes through review.

`store/SUBMIT.md` is the full first-submission procedure, including the privacy tab and the
permission justifications, which change far less often than the description does.

## The one open claim

The description's `OPEN SOURCE` paragraph says:

> Every line is AGPL-3.0-only and public

and points at `https://github.com/ziahamza/parle-extension`, **which is currently a private
repository**. `check-listing.mjs` fails on it deliberately.

This is not a broken link to patch quietly. The submission's whole argument, set out in
`SUBMIT.md` §7, is that a reviewer can check every sentence against the source rather than
believing it. Pointing that reviewer at a 404 removes the check and leaves the claim. There are
two honest resolutions and they are not equivalent:

- **make the repository public**, which restores the claim and the argument; or
- **rewrite the paragraph** to say what is actually true, and accept that the submission is then
  asking for broad host permissions on trust.

Do not resolve it by swapping in a URL that resolves but is not the source.
