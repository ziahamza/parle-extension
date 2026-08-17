# The discussion UI lives in the page, on every browser

[ADR 0016](./0016-native-side-panel-where-it-exists-overlay-where-it-does-not.md) gave Chrome
`chrome.sidePanel` and Safari / iOS the injected overlay. That split is reversed. Every target
now uses the in-page surface that WebKit already had.

## What was wrong

The native panel is per-window browser chrome. Its document is not reloaded on a tab switch and
is told nothing when one happens. Clicking the mark on one article, then switching tabs or
navigating, left Parle's sidebar sitting on the next page — a surface about the current page
that outlived the page.

That lifetime is the opposite of what the product is. The Discussions are about the document
in front of the reader. Leaving that document should take the UI with it.

The split also cost an architecture: a Chrome-only open path (`OpenAside`, a synchronous
`sidePanel.open()` in the port listener, `AsideVisibility`, a third entrypoint) plus a
complete in-page path that had to stay finished because iOS is the constraining platform
(ADR 0003). Two containers, two lifetimes, one renderer.

## What we do instead

The mark toggles the injected dock on every browser. The dock is a node in the page's closed
shadow root. Switching tabs does not put it on the new tab. Navigating the tab away removes
it with the document (`pagehide`, and the same detach on an in-page address change). Coming
back to a tab whose document is still there still shows the dock that was opened there.

The toolbar popup, the first-run page, the mark, badges, Lookups, and the skip list are
unchanged. There is no second extension and no sticky sidebar.

## What was deleted

- The `sidepanel` entrypoint (WXT had been emitting `side_panel` and the `sidePanel`
  permission from it)
- `chrome.sidePanel` feature detection, `open()`, and `onOpened` / `onClosed`
- `OpenAside`, `AsideVisibility`, `ASIDE_PORT`, `AsideKind`, and the `aside` field on
  `Standing`
- `renderAside`, which existed only so a panel that could not leave had words for an empty
  page

## Status

Accepted, 2026-08-17. Supersedes ADR 0016.
