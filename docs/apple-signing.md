# Apple signing for the Safari release

Parle signs with the Zia Capital, LLC Apple Developer team (`85A9MS6428`) —
the same team, certificate, and App Store Connect key that GitEnv's desktop
releases use. The credentials are shared across the team's products; the
GitHub secrets are per-repository and synchronized from one source of truth.

`.github/workflows/safari-release.yml` consumes them. It builds the Safari
containing app from the generated Xcode project, signs it with Developer ID
and the hardened runtime, notarizes the DMG through `notarytool`, staples the
ticket, and publishes only after Apple's own verification tools pass. The App
Store lane (macOS + iOS through the Safari Web Extension Packager) does not
use these secrets at all — Apple signs those builds itself; the workflow only
publishes the audited upload ZIP next to the DMG.

## 1Password source of truth

- Account: `ziahamza.1password.com`
- Vault: `Hamza Assist`
- Item: `GitEnv Apple Developer Signing`
- Item ID: `zuq4k5wldrsnyogezyk6z762oi`

The item is named for GitEnv because that product provisioned it first; every
field in it is team-scoped, not product-scoped. Its layout, certificate
fingerprints, rotation procedure, and the warning against individual (rather
than team) App Store Connect keys are documented in GitEnv's
`docs/apple-signing.md`; that file remains the authority on the credentials
themselves. This file only records what Parle consumes.

## GitHub repository secrets

Each secret has the same name as its 1Password field:

| Secret                   | Used by                                    |
| ------------------------ | ------------------------------------------ |
| `APPLE_CERT_BASE64`      | keychain import (base64 PKCS#12)           |
| `APPLE_CERT_PASSWORD`    | keychain import                            |
| `APPLE_SIGNING_IDENTITY` | `xcodebuild` / `codesign` (Developer ID)   |
| `APPLE_TEAM_ID`          | `xcodebuild` (`DEVELOPMENT_TEAM`)          |
| `APPLE_ASC_ISSUER_ID`    | `notarytool`                               |
| `APPLE_ASC_KEY_ID`       | `notarytool`                               |
| `APPLE_ASC_PRIVATE_KEY`  | `notarytool` (one-time-download `.p8` PEM) |

Restore or resynchronize all of them without printing a value:

```bash
PARLE_REPOSITORY=ziahamza/parle-extension
for field in \
  APPLE_CERT_BASE64 \
  APPLE_CERT_PASSWORD \
  APPLE_SIGNING_IDENTITY \
  APPLE_TEAM_ID \
  APPLE_ASC_ISSUER_ID \
  APPLE_ASC_KEY_ID \
  APPLE_ASC_PRIVATE_KEY; do
  op read --no-newline \
    --account ziahamza.1password.com \
    "op://Hamza Assist/GitEnv Apple Developer Signing/$field" |
    gh secret set "$field" --repo "$PARLE_REPOSITORY"
done
```

Confirm names and update times only:

```bash
gh secret list --repo ziahamza/parle-extension | grep '^APPLE_'
```

Never pass a secret as a command-line argument, paste one into a task, or
write one to a committed file. If a value ever appears in a log or a
transcript, rotate it at Apple first, then in 1Password, then here.

## What is deliberately absent

- **App Store certificates live with the TestFlight lane, not this one.**
  This document's Developer ID material signs the direct-download DMG. The
  App Store lane (`apple-testflight.yml`, documented in
  `store/SUBMIT-SAFARI.md`) builds and signs App Store binaries in CI with
  its own Apple Distribution and Mac Installer Distribution certificates —
  the `APPSTORE_*` Actions secrets, private keys in the 1Password item
  "Parle App Store Signing". Neither lane reads the other's secrets.
- **No dependence on the packager upload.** Apple exposes no API for the
  Safari Web Extension Packager; `apple-testflight.yml` sidesteps it by
  archiving with xcodebuild and uploading with altool, so the browser step
  in App Store Connect is an alternative, not the path. This workflow's job
  is still to make the published ZIP bit-identical to what CI audited.
- **No secrets at the gate.** A missing secret downgrades the Safari release
  to a skipped one with a warning; it never breaks `main`. Mid-build, the
  same absence is a loud failure, so a release cannot fall back to an ad-hoc
  signature.
