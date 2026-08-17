# The browser's own side panel where it exists, our overlay where it does not

**Superseded** by [ADR 0021](./0021-the-discussion-ui-lives-in-the-page.md). Chrome now uses
the same in-page dock as Safari and iOS; the native side panel is gone.

Parle's Discussions are read **beside** the article, not on top of it, wherever the browser
provides a surface for that. Chrome does, through `chrome.sidePanel`; Safari does not, on macOS or
on iOS, and neither does any other API that docks content next to a page.

So there are two containers for one renderer, chosen by feature detection in `src/platform`:

- **Chrome** gets `chrome.sidePanel`. It is real browser chrome — opening it takes width from the
  window, so the article reflows and stays readable. Measured on Chrome 151 through the e2e
  harness: the article's own viewport went from **900px to 514px** when the panel opened.
- **Safari, macOS and iOS**, keep the injected overlay. This is not a fallback and it is not
  deprecated. ADR 0003 makes iOS the constraining platform, so the overlay is the reference
  implementation and must be complete on its own: **no reader-visible behaviour may exist only in
  the native panel.**
- **Firefox** keeps the overlay for now, and see below.

`src/view/render.ts` is unchanged. The panel is a different container, not different rendering —
`renderAside` is a rule for choosing between the two drawings that already existed, and that is the
whole reason this cost so little.

## The constraint that shapes the code

`chrome.sidePanel.open()` may only be called **in the turn the platform delivered the reader's
act**, while the sending frame still has transient user activation. Measured twice, independently,
on Chrome 151:

- The activation **does** survive the whole hop — a trusted click inside the pill's closed shadow
  root, `port.postMessage`, into the background's `runtime.onConnect` listener. This was the thing
  that could have killed the proposal, and it does not.
- It does **not** survive one microtask. `queueMicrotask`, `await null`, `Promise.resolve().then`,
  `setTimeout(0)` and `await chrome.tabs.get()` in front of the call all fail identically with
  ``"`sidePanel.open()` may only be called in response to a user gesture."`` Ten milliseconds of
  *synchronous* work in front of it is fine. It is the turn, not the clock.
- Without a gesture it is refused outright — from `webNavigation`, or from a bare worker call. The
  panel cannot be opened on navigation, which is the correct restraint and is confirmed rather than
  assumed.

Every Ask in `background.ts` is handled on an Effect fiber, which is by construction a later turn
than `port.onMessage`. **So the open is done in the raw port listener in
`src/platform/Extension.ts`, and it cannot be anywhere else.** That is not a shortcut around the
architecture — it is the only place in the architecture where the call is legal, and it is inside
`src/platform`, where ADR 0003 puts every extension API anyway.

This is the one change in the whole proposal that will not be caught by typechecking, by any unit
test that stubs the platform, or by review that has not read this. It has two guards, both of which
were confirmed to fail against the regression before being relied on:

- `src/app/Background.test.ts` asserts the open happens **before** the message-delivering call
  returns. Nothing is awaited between the two lines and nothing may be.
- `e2e/parle.e2e.ts` clicks the real mark with a real trusted mouse event and asserts, through
  Chrome's own `runtime.getContexts`, that the panel opened.

## What was deliberately not done

- **`setPanelBehavior({ openPanelOnActionClick: true })`.** It works, and it silently consumes
  `chrome.action.onClicked`. Parle's built manifest carries `action.default_popup`, and that popup
  is where ADR 0011's degraded states are reachable on every page. Trading it for a second way to
  open the panel is a bad trade.
- **Per-tab enable/disable.** Making a tab with no Discussion have no panel requires
  `setOptions({ enabled: false })` globally plus `setOptions({ tabId, enabled: true })` per tab —
  the per-tab call alone is a no-op while a global path is enabled. It would also put an
  unawaitable `setOptions` in front of `open()`. The panel stays enabled and *says* what it found,
  which is what ADR 0011 asks for anyway: a degraded capability is a state that gets rendered.
- **Firefox's `sidebarAction.open()`.** WXT emits `sidebar_action` from the same entrypoint, so
  Firefox builds the panel document and its reader can open it from Firefox's own sidebar switcher.
  What is *not* wired is opening it from the mark, because whether Firefox's user-action
  requirement survives a `port.postMessage` the way Chrome's demonstrably does **has not been
  measured** — there is no Firefox on the machine this was built on. Chrome's result must not be
  assumed to transfer. Until someone measures it, Firefox reports `in-page` and the mark opens the
  surface it always opened. ADR 0003 puts Firefox after Chrome and Safari regardless.

## Consequences

- **The mark opens; it never closes.** The native panel is per-window and outlives the page; the
  mark is per-page and dies with it. A mark that toggled would let a click on one tab shut a panel
  another tab is reading, and the panel already has the browser's own way out.
- **The panel follows the reader.** Its document is not reloaded on a tab switch and it is told
  nothing when one happens, so `Watch(null)` now keeps meaning "whatever tab the reader is looking
  at" instead of resolving once. A popup could never observe the difference; this container can.
- **The two lifetimes differ and are not abstracted away.** The overlay is about the page it is on
  and goes away with it. The panel is browser chrome and does not. That asymmetry is why the
  capability travels as a state on the wire rather than being hidden behind one interface that
  pretends three surfaces have one lifetime.
- **The overlay lost its only browser coverage on Chrome**, because the Chrome build's mark no
  longer opens it. `pnpm e2e` and `pnpm e2e:shots` therefore also build and run the **Safari-shaped
  build** — which takes the Safari branch for a measured reason, `chrome.sidePanel` being
  `undefined` without the `sidePanel` permission — so the surface that is the whole product on two
  of four targets is still checked and still photographed.
- **An open side panel keeps the MV3 service worker alive.** Parle's budgets and pacing were
  written for a worker that dies. A reader who leaves the panel open has a resident background.
  Recorded here because it is a real behaviour change, not a detail.
- The Chrome store listing gains the `sidePanel` permission. It is neither a host nor a data
  permission and does not touch the Limited Use argument. **The Safari build gains nothing** — no
  entrypoint, no permission — which is the point.
