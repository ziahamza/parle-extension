# iOS simulator checkpoint — 2026-09-22

## Source and results

- Refreshed from `origin/main` at `9ddfbcb` (merged PR #48); no open PRs at this check.
- Main CI run `35745447173` succeeded. This is automated evidence, not iOS UI evidence.
- `pnpm package:safari` succeeded, including the native host audit.
- Simulator build succeeded using:

  ```sh
  xcodebuild -project apps/extension/.output/safari-apple/Parle/Parle.xcodeproj \
    -scheme 'Parle (iOS)' -configuration Debug \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath apps/extension/.output/layout-ios-qa \
    CODE_SIGNING_ALLOWED=NO build
  ```

- Installed the generated `Debug-iphonesimulator/Parle.app` on iPhone 17 Pro,
  iOS 26.5 (`6F59E5A9-0CE5-462C-B782-BE14FFA7C64B`).
- `simctl launch … com.ziahamza.parle` returned PID 87862; launchctl subsequently
  showed the app running. This proves installation and process launch only.
- This is a local simulator build, **not** a TestFlight-installed build.

## Interactive QA blocker

Both installed Xcode applications have Device Hub rather than the traditional
`Contents/Developer/Applications/Simulator.app`. Computer-use access to Device Hub
repeatedly timed out, including explicit launches through Xcode's developer-tools
menu and Finder. Both the stable-path and beta-path Device Hub were attempted.
A process sample of the beta Device Hub showed an idle main event loop, not enough
evidence to diagnose a hang. The simulator returned to Shutdown during the attempts;
the cause is unknown. No simulator data was erased and no permissions were bypassed.

No app-code fix is justified by these tooling symptoms. Do not label visual or
Safari-extension QA as passed from these results.

## Remaining gates, in order

1. Restore interactive access to the simulator, then verify iPhone setup instructions,
   enable the extension, choose the first-run privacy mode, and perform a real lookup.
2. Verify the resulting native Recents row, all Discussion rows, original-page action,
   Archive action when available, and Clear Recents confirmation/cancellation.
3. Verify ordinary browsing does not create Recents. Check a small iPhone and iPad
   layout, plus the newer iOS runtime.
4. Investigate the macOS native-message acknowledgement warning recorded in the
   companion-layout QA note; a persisted row does not prove healthy acknowledgements.
5. Complete physical-device TestFlight QA. Simulator success cannot replace this.
6. Refresh App Store Connect state, select the tested builds for both platforms,
   and submit after the outstanding runtime checks. Apple publication is not complete.

For the actual TestFlight 17 macOS journey and its residual gaps, see
`2026-09-22-companion-layout.md`.
