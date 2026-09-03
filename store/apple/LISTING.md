# App Store Connect and TestFlight metadata - Parle for Safari

**METADATA AND RELEASE-BUILD SCREENSHOTS READY.**

This directory is the source of truth for the Apple listing attached to Apple ID `6804834031`.
The bundle already exists as `com.ziahamza.parle`, with iOS/iPadOS and macOS under the listing
name **Parle for Safari**. Run the standalone audit from the repository root:

```bash
node store/check-apple-listing.ts
```

The audit requires every screenshot listed in a `ready` platform set to exist. All three platform
sets were captured from Release builds, visually reviewed, and are marked `ready` in
`listing.json`.

## 1. App information

| Field | Exact value |
|---|---|
| Name | [`name.txt`](./name.txt) - `Parle for Safari` |
| Subtitle | [`subtitle.txt`](./subtitle.txt) |
| Apple marketing version | `1.0` for both iOS and macOS |
| Primary language | `English (U.S.)` (`en-US`) |
| Primary category | `News` |
| Secondary category | `Utilities` |
| Price | `Free` |
| Sign-in required | `No` |
| Release | `Manual` |

The `1.0` marketing version is independent of the WebExtension package version and must not be
derived from it. Use the same values for the iOS/iPadOS and macOS platform pages. Manual release means approval
must leave the version waiting for the developer to release it; do not select automatic release.

## 2. Product-page localization

Paste these files verbatim for `English (U.S.)`:

| Field | Source |
|---|---|
| Promotional text | [`promotional-text.txt`](./promotional-text.txt) |
| Description | [`description.txt`](./description.txt) |
| Keywords | [`keywords.txt`](./keywords.txt) |
| Marketing URL | `https://ziahamza.com/parle` |
| Support URL | `https://ziahamza.com/parle/support` |
| Privacy Policy URL | `https://ziahamza.com/parle/privacy` |

The App Store description is plain text. Do not paste this Markdown guide into the Description
field. The checker measures Unicode characters for the name, subtitle, promotional text, and
description, and UTF-8 bytes for keywords.

## 3. App Privacy

Use the recommendation and final-binary re-check in [`APP-PRIVACY.md`](./APP-PRIVACY.md):

- **No, we do not collect data from this app.**
- **Tracking: No.**
- Privacy Policy URL: `https://ziahamza.com/parle/privacy`
- Privacy Choices URL: leave empty.

This recommendation is based on Apple's definition, not on the weaker claim that Parle never
uses the network. The device-local Recent list is not transmitted to the developer or an SDK.
The extension's disclosed requests go directly to named public services to answer the reader in
real time. If the final binary adds developer-accessible retention or a collecting SDK, update
the answers before they are published.

## 4. TestFlight

In TestFlight > Test Information > English (U.S.), use:

| Field | Exact value or source |
|---|---|
| Beta App Description | [`beta-description.txt`](./beta-description.txt) |
| Feedback Email | `support@ziahamza.com` |
| Marketing URL | `https://ziahamza.com/parle` |
| Privacy Policy URL | `https://ziahamza.com/parle/privacy` |

For each iOS and macOS build or tester group, paste
[`testflight-what-to-test.txt`](./testflight-what-to-test.txt) into **What to Test**. Keep the
same text for both platforms so a tester can verify the cross-platform contract.

For TestFlight Beta App Review and final App Review, paste
[`app-review-notes.txt`](./app-review-notes.txt) verbatim. App Store Connect still requires a
contact first name, last name, and international-format phone number. Those are account-holder
details, not product metadata, so they are deliberately not invented in this repository. Use
`support@ziahamza.com` for the contact email.

## 5. Screenshots and display order

Apple accepts one to ten screenshots per supported platform. Capture real release-build UI with
no private browsing data, no debug chrome, and no transparency. Use the current dimensions from
Apple's [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
at capture time. The ordered paths are fixed in `listing.json`; keep these files together without
renaming or reordering them.

The same narrative order applies to iPhone, iPad, and macOS. iPhone and iPad use `.png`; macOS
uses `.jpg` with the same numbered stems:

| Order | Filename | Required visible proof |
|---|---|---|
| 1 | `01-recent-on-this-device.png` | Companion Recent list with more than one page, visible network/count summary, and the on-device/30-day explanation |
| 2 | `02-original-and-archive.png` | One Recent detail with both **Open original page** and **Open archived copy** visible |
| 3 | `03-all-parle-discussions.png` | A detail showing **All Parle discussions**, with rows from at least two supported networks |

The macOS filenames are `01-recent-on-this-device.jpg`, `02-original-and-archive.jpg`, and
`03-all-parle-discussions.jpg`.

Directories are `screenshots/iphone/`, `screenshots/ipad/`, and `screenshots/macos/` below this
file. All three images for every platform have been visually reviewed. The checker makes every
ordered path mandatory while each platform remains `ready` in `listing.json`.

The App Store icon is delivered from the signed binary's AppIcon asset catalog. Its checked-in,
full-resolution Apple source is `store/apple/app-icon-1024.png`, generated from the same vector
mark as `store/icons/icon-512.png`; before selecting the build, verify the archive's 1024-by-1024
marketing icon has no transparency and matches that mark. No separate app preview video or
promotional artwork is required for this release.

## 6. Final gates

Before adding the version to App Review:

1. Run `node store/check-apple-listing.ts` with no failures or pending screenshot gates.
2. Open all nine screenshots in order and verify they show the shipped release build.
3. Verify the live marketing, support, and privacy URLs while signed out.
4. Re-check the final signed archives and embedded SDKs against `APP-PRIVACY.md`.
5. Select the processed iOS and macOS builds, complete export compliance and age-rating questions
   from the binary's actual behavior, and enter the real App Review contact name and phone.
6. Keep release mode **Manual**. TestFlight distribution and App Review submission remain explicit
   human actions; metadata validation does not upload or submit anything.

Apple limit references, checked 3 September 2026:

- [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)
- [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)
- [Upload app previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots/)
- [Provide TestFlight test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/)
