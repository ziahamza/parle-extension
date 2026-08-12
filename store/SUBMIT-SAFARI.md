# Safari and iOS release

Parle ships the same WebExtension code on macOS Safari and iOS/iPadOS Safari.
Safari has no side-panel API, so the mark opens Parle's in-page surface: a
right-hand drawer on pointer-driven desktop pages and a full-screen surface on
touch devices. Navigation is at the top on desktop and at the bottom on touch.

## Build artifacts

```bash
pnpm package:safari
```

This produces:

- `.output/parle-safari-web-extension.zip` — upload this to App Store Connect's
  Safari Web Extension Packager.
- `.output/safari-apple/Parle/Parle.xcodeproj` — generated macOS+iOS host apps
  for local Safari, simulator, and signed-device QA.

The generated project is intentionally not versioned. Its interface is the
audited WebExtension ZIP plus the fixed app name and bundle identifier in
`scripts/package-safari.sh`; regenerating keeps native scaffolding aligned with
the installed Xcode rather than freezing an old template in the repository.

Apple's current packager may warn that `background.type` and
`background.persistent` are unsupported even though Apple's WWDC26 Safari Web
Extension example uses `scripts` with `type: module`, and Apple's iOS guidance
requires a nonpersistent background. Parle's bundled background imports its
chunks and therefore requires module mode. The package audit requires both
module mode and `persistent: false`; do not remove either merely to silence
those warnings.

## App Store Connect / TestFlight

1. Create one app record with macOS and iOS platforms and bundle identifier
   `com.ziahamza.parle`.
2. In the app's Xcode Cloud area, open **Safari Web Extension Packager** and
   upload `.output/parle-safari-web-extension.zip`.
3. Wait for both Apple-platform builds, then add the iOS build to TestFlight.
4. Complete privacy, support, screenshots, review notes, and export-compliance
   metadata before App Review. Parle has no analytics, account, or backend.

Apple documents this ZIP-first route at
<https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect>.

## Manual QA: macOS Safari

1. Run the generated **Parle (macOS)** scheme in Xcode.
2. Safari → Settings → Extensions → enable Parle and allow access on all sites.
3. Confirm the disclosure appears before any automatic lookup is enabled.
4. Open a page with a known Discussion and confirm the stacked mark appears.
5. Click the mark: the in-page drawer opens, desktop navigation is above the
   Discussion, nested replies start collapsed, Flat works, and Escape closes it.
6. Confirm a page with no Discussion receives no mark or leftover host element.

## Manual QA: iPhone and iPad

1. Run **Parle (iOS)** on an iOS simulator. A paid Apple Developer account is
   required only for a physical device.
2. Settings → Safari → Extensions → Parle → enable it and choose **Always Allow
   on Every Website** for the release smoke test.
3. Confirm the first-run disclosure and automatic/manual choice are usable.
4. In portrait and landscape, open a page with a Discussion and tap the mark.
5. Confirm the surface fills the viewport, respects the safe areas, keeps its
   navigation at the bottom, scrolls without moving the article underneath,
   and closes through both × and the reopened mark.
6. Expand one reply branch, switch to Flat, open a depth-capped branch on its
   source page, switch Network destinations, and open Digest.
7. Repeat after Safari has been backgrounded long enough to terminate the
   extension background; the next navigation must wake Parle and restore the
   correct page rather than a stale one.
8. Repeat once in Private Browsing and once with Lockdown Mode enabled; record
   refusal states honestly rather than treating them as no Discussion found.

Real-device QA is the release gate for memory pressure, background lifetime,
permission prompts, WebKit layout, and Lockdown Mode. The Chrome-run
Safari-shaped battery proves the shipped fallback branch and responsive CSS,
but it is not evidence about those WebKit/iOS behaviours.
