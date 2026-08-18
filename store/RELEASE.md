# Releasing to the Chrome Web Store

Shipping a new version is one edit:

```bash
pnpm version:bump patch     # or minor, major, or an explicit 3.1.0
```

Commit that on `main` and the rest happens without a browser.
`.github/workflows/release.yml` notices the version changed, runs the full check suite, builds,
zips, audits the package, uploads it and submits it for review. When review passes, the version
goes live at 100%.

The listing — description, screenshots, URLs — is **not** part of this and cannot be.
`store/LISTING.md` explains why and what happens instead.

## How it decides to release

The trigger is the version, not a tag and not a label. `apps/extension/package.json`'s `version`
is the only place the version is written down; WXT copies it into the manifest and into the name
of the zip.

Every push to `main` that touches `apps/`, `packages/`, `store/` or the lockfile runs a cheap
`gate` job which asks the store what it is holding. If the store already has this version, the
run stops there — no build, no upload, green. That is the ordinary outcome, and it is why nothing
has to be remembered: re-runs, reverts, merges during an open review and pushes that change no
code are all no-ops rather than rejected uploads.

`store/cws.ts release` re-checks the same thing before uploading, so the gate is an optimisation
rather than the safety net.

## Doing it by hand

`store/cws.ts` is dependency-free and reads `.env` at the repository root:

```bash
pnpm store:status                                   # what the store is holding
pnpm --filter @parle/extension exec wxt zip         # build the package
node store/check-release.ts apps/extension/.output # audit it
pnpm store:release                                  # upload + submit
```

Other subcommands: `upload` (no submit), `publish` (submit what is already uploaded), `cancel`
(withdraw a pending submission — useful when a bad build is sitting in review).

To stage a release instead of shipping it on approval, set `CWS_PUBLISH_TYPE=STAGED_PUBLISH`; the
version passes review and then waits for you to press the button in the dashboard.

`CWS_FORCE=1` uploads even when the store already holds the version — the `force` input on
`workflow_dispatch` sets it. It is an escape hatch for re-uploading a draft, not a way around the
store's rule that a version must be strictly greater; expect a 400 if it is not.

`fetchStatus` reports the published and submitted revisions and nothing else, so a package that
was uploaded but never submitted is invisible to it. `release` will re-upload in that case, which
overwrites the draft and is harmless.

## What the workflow does after submitting

It tags the commit and attaches the zip to a GitHub release — **non-fatally**. The store
submission is irreversible and the tag is bookkeeping, so a failure there is logged rather than
raised: failing the job would leave a submitted version behind a red build, and because the next
push would gate `ship=false`, the tag would never be retried. If the tag is missing after a
successful release, create it by hand.

## The credentials

Authentication is a Google Cloud **service account**, not an OAuth refresh token. Refresh tokens
for an app left in "Testing" expire after seven days and fail silently months later; a service
account does not expire.

| Where | What |
|---|---|
| Google Cloud project | `parle-release-cws`, Chrome Web Store API enabled |
| Service account | `parle-store-release@parle-release-cws.iam.gserviceaccount.com` |
| Registered at | Developer Dashboard → **Account** (one service account per publisher, maximum) |
| GitHub secret | `CWS_SERVICE_ACCOUNT_KEY` — the JSON key, base64 of it (`base64 -w0`) |
| GitHub variables | `CWS_EXTENSION_ID`, `CWS_PUBLISHER_ID` |
| This machine | `.secrets/cws-service-account.json`, mode 600, pointed at by `.env` — both gitignored |

The private key was generated locally and only the **public** X.509 certificate was uploaded to
Google, so the private half has never been transmitted anywhere. That also means Google cannot
re-issue it: if it is lost, upload a new certificate rather than trying to download the old key.

### Rotating it

```bash
openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
  -keyout private.pem -out public.pem -subj "/CN=parle-store-release"
```

Upload `public.pem` at Google Cloud console → IAM → Service accounts → `parle-store-release` →
**Keys** → *Add key* → *Upload existing key*, note the key id it reports, rebuild the JSON around
the new `private_key`/`private_key_id`, then:

```bash
base64 -w0 service-account.json | gh secret set CWS_SERVICE_ACCOUNT_KEY -R ziahamza/parle-extension
```

Delete the old key in the console afterwards.

## Why these are TypeScript, and why there is no build step

Every tool named above is a `.ts` file executed straight by `node`. Node 24 strips the types at
load, so there is no compile, no `dist/`, and no artifact that can drift from its source.

That is not a preference, it is a constraint the release workflow imposes. The `gate` job runs
`store/version.ts` and `store/cws.ts` with `actions/setup-node` and **no `pnpm install`**, so the
cheap question — is there a new version to ship? — costs a checkout and a Node, not a dependency
tree. Anything requiring a build could not answer it without the install that arrangement exists
to avoid. `tsx` has the same problem: it is a devDependency.

`erasableSyntaxOnly` in `tsconfig.base.json` is what keeps this from breaking silently. It
rejects `enum`, `namespace` and parameter properties — precisely the constructs Node cannot
strip — so a file that would fail to run fails to typecheck first.

`tsconfig.tools.json` type-checks all of it with `noEmit`, and `pnpm typecheck` runs it after the
per-package pass, so these scripts are held to the same `strict` settings as the extension.

## Which API this uses

Chrome Web Store API **v2** (`chromewebstore.googleapis.com`) only. v1
(`www.googleapis.com/chromewebstore/v1.1`) is what most published GitHub Actions still call and it
is **switched off on 15 October 2026**; v2 is also the only version that accepts service accounts.
`store/cws.ts` speaks v2 directly rather than depending on a third-party action, which is a
smaller surface than it sounds: five endpoints, one signed JWT, no dependencies.

## When it goes wrong

| Symptom | Cause |
|---|---|
| `403 Permission denied on resource 'publishers/…'` | the service account is not registered in the dashboard's Account page, or `CWS_PUBLISHER_ID` is wrong |
| `could not get an access token` | Chrome Web Store API not enabled on `parle-release-cws`, or the key was revoked |
| upload rejected on version | the store already holds this version — bump and push again |
| gate says "skipping the release" | `CWS_PUBLISHER_ID` or `CWS_SERVICE_ACCOUNT_KEY` is unset in the repository's settings |

A rejection from **review** arrives by email at the publisher contact address, not through the
API. `pnpm store:status` will show the submitted revision sitting in a non-published state;
`SUBMIT.md` §6 covers what a rejection email means and how to answer it.
