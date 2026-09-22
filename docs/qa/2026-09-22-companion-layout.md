# Native companion layout regression

## Reproduction

On macOS 27.0 (26A428), the native TestFlight 1.0 (15) companion opened
at 760 x 640 content points with a 144-point sidebar and an empty detail
area. Titles, domains, and the settings button were truncated. The converter
storyboard also omitted the resizable window style. An accessibility snapshot
reported `splitter ... 144` and a disabled zoom button.

## Fix

- Constrain the macOS navigation list to 320–420 points.
- Supply an explicit unselected detail view.
- Use an inset list so multiline instructions are not clipped by sidebar styling.
- Keep domains on one line and reserve space for relative dates.
- Render retention text and Clear Recents in the desktop list: the embedded
  host does not display the SwiftUI toolbar and sidebar footers reliably.
- Enable window resizing/minimization and configure its initial size only once.
- Keep iOS stack navigation unchanged.

## Native verification

Built the generated macOS app with the local Developer ID identity and opened
that exact build through computer use. The existing three local fixture entries
were preserved; these are layout fixtures, not evidence of live Safari capture.

- Initial accessibility snapshot: splitter 320, enabled zoom/minimize controls,
  unselected detail guidance, retention disclosure, and Clear Recents present.
- Screenshot: full settings button, wrapped instructions and retention copy,
  readable titles and single-line domains.
- Selecting the first fixture displayed original/archive actions and all seven
  saved discussions.
- Zooming and restoring the window preserved the layout.
- Clear Recents opened its confirmation; Cancel preserved all entries.
- Dragging the corner did not change the captured size in this automation run;
  minimum-size drag behavior still needs an independent check.

The regression oracle is the native accessibility snapshot plus rendered window,
not a substring assertion against Swift source. This repository does not yet
have an XCTest UI harness for the embedded companion.

## Separate release gate

The TestFlight macOS build was reinstalled from Apple's client after obsolete
app bundles were moved to recoverable Trash. macOS discovers the signed extension,
but Safari initially omitted Parle from Extensions settings. Removing six stale
development registrations with `pluginkit -r` (without deleting those builds),
then re-registering `/Applications/Parle.app/Contents/PlugIns/Parle Extension.appex`,
restored the TestFlight extension in Settings. It is active in the Default profile.
Its popup still stalls at "Looking…", including after a normal Safari restart;
the Develop menu labels its background content "not loaded". Discovery is recovered,
but runtime operation is not yet established. Live Safari-to-companion capture,
TestFlight verification of this new build, and physical iOS QA remain separate
gates before claiming the Apple release is ready.

Both the macOS build and iOS Simulator build compiled successfully locally.
The first CI run passed the 82 Chrome behaviours and both Apple package builds,
but failed one of 48 adversarial checks: the rapid-navigation toolbar-title check
observed the default "Parle" title. The unchanged failed job was re-run rather
than weakening its assertion, but that retry was superseded by the startup fix.
The subsequent complete CI run on `4c3ba1f`,
[35743535179](https://github.com/ziahamza/parle-extension/actions/runs/35743535179),
passed all **82 behaviour checks and 48 adversarial checks**, types/unit/build
checks, and the macOS/iOS package job. No assertion was weakened. The first
failure remains a timing-flakiness candidate, not a proven product regression
or a claim that its underlying cause was fixed.

## TestFlight and startup follow-through

Build 16 uploaded successfully for macOS and iOS in run 35742291283. Installed
the macOS update through TestFlight and verified the new layout, seven discussion
rows, and enabled-extension status in the actual distributed app.

Safari Settings then exposed the background startup error:
`TypeError: undefined is not an object (evaluating 'd.addListener')` at
`chunks/standingArtifact-DXOd7xwK.js:29:38673`. Mapping the installed bundle's
reported position locates `liveNavigation.watch`: it assumes every webNavigation
event exists whenever the namespace exists. Missing events abort startup before
the popup receives a response.

Three regression cases against the real live adapter reproduce the same
`addListener` exception, independently omitting each previously mandatory event.
The fix treats those events as optional, retaining available navigation events,
the tabs.onUpdated fallback, and listener cleanup. All 52 browser-package tests
and its typecheck pass. This must still be verified in native Safari after the
replacement build is installed; unit-test success alone is not runtime proof.

## Final native checkpoint (TestFlight 17)

Run [35743529114](https://github.com/ziahamza/parle-extension/actions/runs/35743529114)
successfully uploaded both platforms. Installed macOS 1.0 (17) through TestFlight.
Safari's own inspector confirmed that `onHistoryStateUpdated` and
`onReferenceFragmentUpdated` are undefined while `onCommitted` exists. The old
startup exception is gone. Temporary console probes were removed by reloading
the background context and closing the inspector before the final lookup.

With **Only when I ask** selected, opened the toolbar on the public test article
`https://www.paulgraham.com/ds.html`. The toolbar rendered the article and manual
lookup action. Keyboard activation of that focused action produced seven visible
discussions. The companion then displayed a fresh entry with the same seven
discussions: four Hacker News, two Reddit, and one Lemmy, with titles/counts/links.
This is new runtime data, not the three older fixture entries. The original-page
action was present; no Archive result was available in this manual-mode check.

The corrected 320-point sidebar, wrapped setup text, detail selection, and enabled
extension status were verified in the installed TestFlight app. During earlier
inspection Safari logged native acknowledgement warnings even though entries
were persisted; that warning path needs follow-up, not a claim of complete
native-transport health. Physical iOS Safari, corner-drag/minimum-size behavior,
and a live Archive round-trip are still unverified. Neither Apple App Store
submission was sent during this checkpoint.

Latest complete CI on documentation head `2ce533e`:
[35744118984](https://github.com/ziahamza/parle-extension/actions/runs/35744118984)
passed 82/82 behaviours, 48/48 adversarial checks, types/unit/build, and both Apple
package builds. This final addition changes QA documentation only.
