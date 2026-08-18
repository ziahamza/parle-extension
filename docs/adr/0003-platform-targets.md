# Chrome and Safari (macOS + iOS) ship together in v1

v1 targets the Chrome Web Store and the App Store simultaneously, rather than shipping Chrome first and porting later. Mobile is where most reading actually happens and no comparable extension exists on a phone, so the mobile experience is treated as a differentiator to prove immediately rather than a later port. Firefox desktop and Firefox for Android follow.

## Facts this rests on

- **Chrome for Android does not support extensions** and never has. "Android support" therefore means **Firefox for Android**, not Chrome — a later target, and a smaller audience than the word "Android" suggests.
- **Safari on iOS no longer requires a Mac or Xcode for distribution.** Since iOS 26, a standards-based WebExtension can be uploaded to App Store Connect as a ZIP and packaged by Apple. Xcode remains the path for local simulator and attached-device QA; a paid Apple Developer account and App Review still apply.
- **WXT defaults to MV2 for Safari and Firefox, MV3 elsewhere.** We override this: MV3 everywhere, one manifest model.

## Consequences

- **No direct `chrome.*` calls anywhere.** The background layer is written against our own Effect-based abstraction over the extension APIs, so a browser difference is a change in one adapter rather than a change everywhere.
- Cross-browser builds run in CI from the first commit; a change that breaks the Safari build fails the same way a failing test does.
- The shared view has one adaptive navigation: top on pointer-driven desktop surfaces, bottom on touch and mobile ones — decided by `@media (min-width: 640px) and (hover: hover) and (pointer: fine)`, not by which browser is hosting it. **Amended by [ADR 0021](./0021-the-discussion-ui-lives-in-the-page.md):** this line originally also named browser-owned desktop sidebars, because Chrome had a native side panel and Safari did not, and Safari's lack of one was described as changing the container. There is now one container on every target — the in-page dock — so there is no container difference left for a platform to change.
- App Review is on the critical path to v1. The build flag from [ADR 0001](./0001-x-access-via-user-session.md) that compiles X session search out exists precisely so a rejection delays one Network rather than the whole release.
- Safari on iOS has tighter memory limits and a per-site permission model than desktop Chrome. Anything expensive — long thread fetches, model inference — must be sized for the iOS build, which is the constraining platform, not the desktop one.
