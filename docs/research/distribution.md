# Distribution: the most seamless install path per platform

Researched 24 August 2026 against primary sources (Apple developer documentation,
Apple support guides, Mozilla add-ons blog and MDN, Chromium/Google channels,
first-party vendor docs). Every load-bearing claim carries the URL that owns it.
This answers one question: **what is the shortest honest path from "a reader wants
Parle" to "Parle is running in their browser", on each platform — and what should
this project do about it.**

---

## Answer first

### Chrome (desktop) — already solved

**Route: Chrome Web Store listing, already published** (`store/SUBMIT.md` records
it as public at v3.0.0). The user journey is the baseline everything else is
measured against:

1. Open the store listing.
2. Click **Add to Chrome**, confirm the permission dialog.
3. Done — the first-run page opens itself.

Two clicks. Nothing on any other platform matches this.

### Safari macOS — ship through the Mac App Store, from the same app record as iOS

**Route: Mac App Store, via the App Store Connect Safari Web Extension Packager**
(the ZIP-first flow already in `store/SUBMIT-SAFARI.md`). User journey:

1. Open the App Store listing (one link works for Mac and iPhone — same app record).
2. Click **Get**; the containing app installs.
3. Open the app once. Its only real job is to say "enable me in Safari".
4. Safari → Settings → Extensions → turn on Parle.
5. Grant website access when Safari asks.

Developer ID + notarization outside the store is *allowed* and real
(evidence below), but it does not remove step 3–5, adds a Gatekeeper first-open
dialog, and costs us a separate signed build and update channel — for the same
$99/yr membership either way. It is a good escape hatch if App Review rejects us,
not the default.

### Safari iOS/iPadOS — App Store, and the app must teach the enablement

**Route: the App Store. There is no other route** (TestFlight for beta). User
journey on current iOS, using Safari's own UI (the shortest of the two paths):

1. Install the app from the App Store.
2. Open Safari, tap the icon at the left of the address bar → **Manage
   Extensions** → turn on Parle.
3. When Parle first acts on a site, Safari asks per-site permission; the user
   picks Allow once / Always Allow / Every Website.

The longer path (Settings → Apps → Safari → Extensions → Parle → Allow
Extension) still exists and is what 1Password and AdGuard document as the
fallback. **No API deep-links the user to either screen on iOS** — the only
"open Safari's extension preferences" API Apple ships is macOS-only. So the
containing app's one screen must do what 1Password's and AdGuard's do: show the
exact steps, with pictures, and detect when enablement has happened.

### Android — Firefox for Android via AMO, and say so honestly

**Route: list on addons.mozilla.org with `"gecko_android": {}` in
`browser_specific_settings`.** That is the entire additional cost — same AMO
listing, same free account. User journey:

1. Install Firefox from Google Play.
2. Menu → Extensions (or the AMO Android page) → find Parle → **Add**.
3. Confirm permissions.

Chrome for Android has never supported extensions and Google states no plans to
change that. Everything else on Android (Edge Canary, the late Kiwi, Samsung
Internet) is experimental, dead, or gated — evidence below. There is no
app-shaped shortcut: an Android app cannot inject into other browsers, so "a
Parle Android app" would mean shipping our own GeckoView/WebView browser, which
is a different product and is not proposed.

### Beta channels

- **iOS + macOS beta: TestFlight**, up to 10,000 external testers, invitable by
  a public link. The packager flow feeds it directly.
- **Firefox for Android pre-release: unnecessary for us.** The old
  custom-collection dance is only needed in Nightly for extensions *not* openly
  listed; since December 2023 a plain AMO listing marked Android-compatible is
  the distribution. An unlisted/beta AMO version plus Firefox Beta covers
  pre-release testing.

---

## Safari on macOS — the evidence

**A containing app is mandatory.** Apple: "Safari supports distributing a web
extension in a macOS app, a visionOS app, an iOS app, or a Mac app created using
Mac Catalyst." There is no appless install for Safari web extensions.
<https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension>

**Outside-the-store distribution is explicitly allowed on macOS.** Same page:
"If you provide your extension in macOS and don't want to use the Mac App Store
for distribution, you can sign and notarize your extension's app with a
Developer ID to distribute it outside the Mac App Store." The user downloads the
app, opens it once (Gatekeeper verifies the notarization), then enables the
extension in Safari → Settings → Extensions — the enablement step is identical
to the App Store route, per Apple's own user guide for Safari extensions.
<https://support.apple.com/en-us/102343>

**Both routes need the paid Apple Developer Program.** "To distribute your web
extension, first join the Apple Developer Program" — and Developer ID
certificates for notarized distribution are themselves a Program benefit. There
is no free tier for either door. (Program cost: 99 USD/year,
<https://developer.apple.com/support/enrollment/>.)
<https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension>

**What the App Store Connect packager buys us over a maintained Xcode project.**
The packager lets you "package and distribute your Safari extensions using App
Store Connect from any web browser, without requiring a Mac or access to
Xcode": upload the extension ZIP ("the full contents of your extension,
including the manifest and all related resources"), and Apple generates and
builds the containing apps on Xcode Cloud (billed against the 25 free
hours/month in the membership). "The Safari web extension packager can create
apps for both macOS and iOS. People can use the iOS app and extension on iOS,
iPadOS, and visionOS." That is precisely the shape `store/SUBMIT-SAFARI.md`
already documents; the versioned artifact stays the audited WebExtension ZIP,
and the local `xcrun safari-web-extension-packager` project in
`apps/extension/scripts/package-safari.sh` remains only for simulator/device QA.
<https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect>

**One app record covers both platforms.** The packager flow has you create one
app record and "select the platforms (macOS, iOS, or both)" under one bundle
identifier — which is why `store/SUBMIT-SAFARI.md` step 1 says one record with
both platforms and `com.ziahamza.parle`. One listing URL, one review pipeline,
one purchase (free) that installs on Mac, iPhone and iPad.
<https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect>

**Why the Mac App Store over Developer ID as the default.** Not because Developer
ID is worse for the user at install time — it is roughly equivalent (download,
open, enable) — but because: the packager only feeds App Store
Connect/TestFlight, so Developer ID would mean maintaining the Xcode project as
a second release pipeline with its own signing, notarization and update
mechanism (Sparkle or manual); and the store gives macOS and iOS one shared
listing. Keep Developer ID in the back pocket for the ADR 0003 scenario where
App Review stalls the whole release: the macOS half can ship outside the store
while the argument proceeds; the iOS half cannot.

**A macOS nicety worth building:** the containing app can call
`SFSafariApplication.showPreferencesForExtension(withIdentifier:)` to launch
Safari and open the extension's preferences pane directly — "Launches Safari and
opens the preferences panel for a Safari app extension", macOS 10.12+. That
turns step 4 of the journey into one button in our app. It does not exist on iOS.
<https://developer.apple.com/documentation/safariservices/sfsafariapplication>

## Safari on iOS/iPadOS — the evidence

**App Store only.** The distribution page's platform list (iOS app, or Mac
Catalyst app) plus the absence of any sideloading/notarization channel for iOS
apps in the developer documentation means the App Store — with TestFlight as its
beta ante-room — is the whole set of options. (EU alternative marketplaces exist
under the DMA but are not a distribution strategy for a small free extension and
are region-locked; not pursued here.)
<https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension>

**The enablement flow on current iOS — two doors, both documented by Apple.**
The iPhone User Guide ("Get extensions to customize Safari on iPhone",
covering iOS 18/26-era Safari):

- In Safari itself: "tap the left side of the search field, then tap **Manage
  Extensions**, and turn each extension on or off." The same sheet can browse
  the App Store's extension section directly.
- In Settings: "Settings → **Apps** → **Safari** → **Extensions**, tap an
  extension and turn on **Allow Extension**" — with the note that Safari
  profiles each need it enabled separately.

<https://support.apple.com/guide/iphone/get-extensions-iphab0432bf6/ios>

The in-Safari door is the one to teach: it is shorter, it is where Apple has
been moving enablement since iOS 15 introduced extensions and iOS 17/18
polished the address-bar menu, and it is the one 1Password now leads with.

**Per-site permissions are real and unavoidable.** The same guide covers the
prompt: an extension acting on a site triggers Safari's permission sheet, and
the user chooses per-site or everywhere, once or always. AdGuard's setup doc
spells out the consequence for an every-page extension like ours: "make sure All
Websites is set Allow or Ask. If you choose Allow, you won't have to give
permission every time you visit a new website."
<https://support.apple.com/guide/iphone/get-extensions-iphab0432bf6/ios>,
<https://adguard.com/kb/adguard-for-ios/web-extension/>

For Parle specifically this stacks with our own first-run question: Safari asks
"may this extension see this site", then Parle asks "may I look pages up
automatically". Two consent gates is honest, but the onboarding must present
them as one story or iOS users will fall out between them.

**No deep link to the settings screen.** `SFSafariApplication` — the only API
that opens Safari's extension preferences — is macOS-only. Nothing in
SafariServices for iOS opens Settings → Apps → Safari → Extensions or Safari's
Manage Extensions sheet from the containing app. Best-in-class apps therefore
do it with instructions:

- **1Password**: "Open Safari and navigate to any website. Select ᴀᴀ in the
  address bar, then select Manage Extensions. Turn on 1Password, then select
  Done" — then a second illustrated step for granting "Always Allow on Every
  Website". <https://support.1password.com/getting-started-safari-ios/>
- **AdGuard**: an in-app onboarding, then an illustrated walkthrough of
  Settings → Apps → Safari → Extensions → Allow Extension, then the All
  Websites permission — and it also documents the in-Safari route as the
  alternative. <https://adguard.com/kb/adguard-for-ios/web-extension/>

The containing app Apple's packager generates is a static shell. The
recommendation is to replace its content (the packager copies resources; the
generated project accepts edits, or the shell page it displays can be ours) with
exactly this pattern: one screen, the two steps illustrated, and — since an iOS
extension and its app share an app group / shared storage — flip to a "you're
done" state once the extension has actually run.
<https://developer.apple.com/documentation/safariservices/sfsafariapplication>

**Beta: TestFlight.** Apple: "Invite up to 10,000 external testers using their
email address or by sharing a public link." Public-link groups can be capped
between 1 and 10,000 and revoked at any time. TestFlight covers iOS *and* macOS
builds, so one packager upload gives beta channels for both Apple platforms.
<https://developer.apple.com/testflight/>,
<https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers>

## Android — the evidence

**Chrome for Android: no extensions, full stop.** Chrome's extensions
documentation has stated for years that extensions are not supported on mobile;
the Chromium extensions team's own channel, asked directly, answers that
extensions are not supported on Chrome for Android and there are no plans to
announce. The 2025–26 "desktop Chrome on Android" builds with extension support
target large-screen/Chromebook-class devices, not phones, and nothing has
shipped to stable phone Chrome.
<https://groups.google.com/a/chromium.org/g/chromium-extensions/c/LscNuM8AIaw>

**Firefox for Android: the one real, open channel.** Mozilla opened the
ecosystem on 14 December 2023 — "a new open extension ecosystem on mobile" with
450+ extensions at launch, installable by users straight from AMO's Android
page or the in-browser extensions manager.
<https://blog.mozilla.org/addons/2023/12/14/a-new-world-of-open-extensions-on-firefox-for-android-has-arrived/>,
<https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android>

What a listing needs to appear there, per MDN: "To support Firefox for Android
without specifying a version range, the `gecko_android` sub-key must be an empty
object … Otherwise, the extension is only made available on desktop Firefox."
Plus the practical requirements Mozilla's Extension Workshop names: verify the
APIs you use exist on Android, and use a non-persistent background —
which Parle already satisfies everywhere because Safari iOS forces the same
constraint (ADR 0003: iOS is the constraining platform).
<https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings>,
<https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/>

One Workshop caveat to test rather than trust: it has recommended MV2 for
Android where MV3 parity lagged. Parle is MV3-everywhere by decision (ADR 0003);
the Android port's gate is therefore "run the battery on Firefox for Android
MV3", not a manifest fork.
<https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/>

The **collection method** — create an AMO collection, enable Firefox Nightly's
debug menu (tap the logo five times), point "Custom Add-on collection" at it —
is the pre-2023 workaround and still works in Nightly for unlisted testing, but
Mozilla aimed it at "extension developers and advanced users", it caps at ~50
visible add-ons, and open availability made it unnecessary for distribution.
Plain AMO listing wins.
<https://blog.mozilla.org/addons/2020/09/29/expanded-extension-support-in-firefox-for-android-nightly/>

**Everything else on Android, honestly:**

- **Microsoft Edge for Android**: extension support exists but remains confined
  to Canary/experimental builds with "unverified for mobile" warnings; Microsoft
  has published no timeline for stable. Not a channel to plan on; costs nothing
  when it arrives, since it consumes ordinary Chromium extensions.
  <https://learn.microsoft.com/en-us/answers/questions/2386037/when-will-extensions-be-supported-for-android-edge>
- **Kiwi Browser**: discontinued — archived and unmaintained after January 2025,
  pulled from Google Play; its extension code was donated toward Edge.
  Dead channel. <https://github.com/kiwibrowser/src.next>
- **Samsung Internet**: no open WebExtensions. Its extension system is
  Samsung-approved apps ("All 3rd party extension apps are validated and
  approved by Samsung"), in practice content blockers and a few partners; there
  is no self-serve store for a general extension like Parle.
  <https://developer.samsung.com/internet/android/extensions-dev-overview.html>
- **Orion (Kagi)**: runs Chrome/Firefox extensions on iOS/macOS with partial
  API coverage, but "an Android version is not currently being worked on".
  Irrelevant to Android; a bonus surface on iOS if users bring it, not a target.
  <https://help.kagi.com/orion/faq/faq.html>,
  <https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html>
- **A native Android app**: Android offers no mechanism for an app to extend or
  inject into another vendor's browser. The only app-shaped route is to *be*
  the browser — bundle GeckoView or WebView and ship "Parle Browser". That is a
  different product with a different maintenance surface and a different
  competition, and adopting it to dodge a store gap would be exactly the scope
  creep ADR 0004's "upgrade, not a dependency" posture exists to refuse. Stated
  plainly: not an option we take.

## Costs and review, consolidated

| Channel | Cost | Review |
|---|---|---|
| Chrome Web Store | $5 one-time developer registration (paid long ago; item live) | Chrome review; done — v3.0.0 public per `store/SUBMIT.md` |
| App Store (macOS + iOS, one record) | Apple Developer Program, 99 USD/year (<https://developer.apple.com/support/enrollment/>) | App Review, both platforms; TestFlight builds get a lighter beta review |
| Developer ID outside the Mac App Store | same 99 USD/year membership | no App Review; notarization is an automated malware scan |
| addons.mozilla.org (desktop + Android, one listing) | free | AMO review; Android availability is a manifest key, not a second review |

The $99/yr is unavoidable for any Safari presence at all — packager, Xcode, App
Store, TestFlight, and Developer ID all sit behind Program enrollment.

## What we cannot make seamless

Being honest about the ceiling, because the onboarding copy has to be:

- **iOS enablement friction is Apple's, not ours.** Install app → open Safari →
  Manage Extensions → enable → per-site permission is the minimum journey Apple
  allows. No API shortens it; no deep link exists. The best in the business
  (1Password, AdGuard) ship illustrated instructions, which is an admission
  that instructions are the state of the art. Our containing app should be the
  best version of that admission, and our App Store screenshots should show the
  enablement, not just the product.
- **macOS still has the "open the app once, then go to Safari Settings" hop.**
  `showPreferencesForExtension` shrinks it to one button but cannot remove the
  Safari-side toggle — that consent is by design.
- **Per-site permission prompts on iOS double our consent story.** Safari asks,
  then Parle asks. We cannot merge them; we can only sequence them coherently.
- **"Android support" means "Firefox for Android support."** Chrome's Android
  users — the overwhelming majority — cannot install Parle and there is no
  channel by which they could, short of us shipping a browser, which we will
  not. ADR 0003 already says this; the listing copy for Android should too.
- **Universal purchase is one listing, not zero steps.** One App Store link
  serves Mac and iPhone, but each device still walks its own enablement.

## What this project should do

1. **Keep the ZIP-first packager route in `store/SUBMIT-SAFARI.md` as the Apple
   release pipeline**, one app record, both platforms, `com.ziahamza.parle`.
   It is Apple's own recommended path and the generated-not-versioned Xcode
   project stays a QA tool.
2. **Make the containing app a real onboarding screen**, not the packager's
   placeholder: illustrated enable-steps per platform, the macOS
   `showPreferencesForExtension` button, a shared-storage "it's working" state,
   and the same disclosure the first-run page makes.
3. **Add `"gecko_android": {}`** to the Firefox build's
   `browser_specific_settings` when the Firefox listing ships, and run the
   battery on Firefox for Android before flipping it — Android availability is
   a one-line manifest change on top of the AMO listing, and MV3-on-Android is
   the thing to verify, not assume.
4. **Use TestFlight public links for the Apple beta** (both platforms from one
   upload) and an unlisted AMO version + Firefox Beta for the Android beta;
   ignore the Nightly collection method unless debugging demands it.
5. **Keep Developer ID + notarization as the macOS-only escape hatch** if App
   Review stalls — and keep its plumbing warm rather than theoretical:
   `.github/workflows/safari-release.yml` signs, notarizes, staples, verifies
   and publishes the DMG on every version bump (secrets and provenance in
   `docs/apple-signing.md`), so the hatch is exercised continuously instead of
   discovered broken on the day it is needed. What stays deferred is making it
   a *user-facing channel*: no Sparkle/update mechanism, no install docs
   pointing at it while the App Store lane is the story.
