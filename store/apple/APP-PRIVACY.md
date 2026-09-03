# App Privacy recommendation

Recommended App Store Connect answer for this binary:

> **No, we do not collect data from this app.**

Also answer **No** to tracking. This recommendation applies at the app level to the iOS/iPadOS
and macOS versions together. Confirm it against the final archived binaries and every embedded
SDK before publishing the answers.

## Why this is the conservative answer under Apple's definition

Apple defines collection around data transmitted off the device in a form that the developer or
an integrated third-party partner can access for longer than is needed to service the request in
real time. Apple also says the answers must include a developer's practices and those of external
vendors whose code is integrated into the app.

Parle has no developer server, account system, analytics, telemetry, advertising SDK,
crash-reporting SDK, or other third-party SDK. The companion's Recent list is stored in a local
App Group container. It never goes to the developer, never uses iCloud, and never syncs. The list
is bounded to 100 pages or 30 days and can be cleared from either the companion or the extension.

The extension does make direct, real-time functional requests to Hacker News, Reddit, Bluesky,
Lemmy, Lobsters, the Internet Archive, and Wikipedia. Those public services receive the page or
site needed to answer the reader's request and may independently process it under their own
policies. Their code is not embedded in Parle, and neither the developer nor an integrated SDK
receives or retains those requests. The live privacy policy names every service, endpoint, data
field, trigger, retention rule, and external policy. On that implementation, those requests are
not developer or integrated-SDK collection under Apple's real-time-request definition.

This is not a permanent exemption. Change the App Privacy answers before release if the final
binary adds a backend, server logging accessible to the developer, analytics, telemetry, crash
reporting, advertising, an SDK that collects data, cloud sync, or any transmission retained
beyond what is necessary for the real-time feature.

## Submission values

| App Store Connect question | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | **No, we do not collect data from this app** |
| Is data used to track users? | **No** |
| Privacy Policy URL | `https://ziahamza.com/parle/privacy` |
| Privacy Choices URL | Leave empty; the app has no developer-held account or data store to manage |

## Evidence to re-check before publishing

- `apps/extension/apple/PrivacyInfo.xcprivacy` declares only the platform APIs the binary uses;
  it must not conceal an SDK data path.
- The signed archives contain no analytics, advertising, crash-reporting, or remote-code SDK.
- `store/privacy-policy.md` still matches the live policy at
  `https://ziahamza.com/parle/privacy`.
- The native companion still stores Recents only in the device-local App Group container and the
  browser extension still sends them only after an explicit Parle open.

Primary Apple references, checked 3 September 2026:

- [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
