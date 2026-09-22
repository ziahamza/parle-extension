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
but Safari still omits Parle from Extensions settings. This layout fix does not
establish that the Safari activation issue is resolved. Live Safari-to-companion
capture, TestFlight verification of this new build, and physical iOS QA remain
separate gates before claiming the Apple release is ready.
