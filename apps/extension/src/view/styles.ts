/**
 * The panel's stylesheet, as a string, because it has to live in two places.
 *
 * The popup can have a real stylesheet; the in-page surface cannot — it renders
 * inside a Shadow DOM precisely so that no host page's CSS can reach it, which
 * also means no host page's stylesheet is available to it. One string, a
 * `<style>` in the shadow root and a `<style>` in the popup, is the only
 * arrangement where the two surfaces cannot drift.
 *
 * **The prose lives up here and not in the CSS.** Comments inside the template
 * literal are bytes in the script injected into every page the reader opens;
 * comments up here are removed by the bundler. ADR 0003 makes iOS the
 * constraining platform, so the reasoning is written once, at length, in the
 * place that is free, and the stylesheet below carries section markers only.
 *
 * ## The system
 *
 * Four type sizes, five spaces, three radii, one accent, one elevation, one
 * motion curve — declared once as custom properties and re-declared once for
 * dark. A rule that reaches for a literal colour or a fifth font size has left
 * the system. Dark mode is a real second palette, not an inversion: the surface
 * is `#101216` rather than black so the one elevation still reads against it.
 *
 * The scale is re-declared a **third** time under 640px, one step up: 12 / 15 /
 * 17 where the desktop has 11 / 13 / 15. Not a concession to small screens but
 * the opposite — ADR 0003 makes iOS the constraining platform, and 13px on a
 * phone held at arm's length is a desktop panel that has been made narrow
 * rather than a surface designed for a phone. The same media query gives the
 * close button 40px and lets the heading run to two lines, because at 390px
 * minus that button an ellipsis lands inside the first clause of most
 * headlines and the panel stops saying which page it is about.
 *
 * `--parle-faint` is `#6f7683` and not the `#868d99` it was: the address, the
 * points-and-comments line and the group notes are all set in it at 11px, and
 * the lighter grey was under 3:1 against the surface. Nothing about the design
 * wanted it that light — it was the smallest number that still looked quiet.
 *
 * The tokens are declared on `:host` *and* on each root class because the two
 * surfaces are shaped differently: inside the shadow root `:host` is the only
 * common ancestor of the mark and the panel, and in the popup there is no host
 * at all. `all: initial` does not reset custom properties, so the reset can sit
 * on the same elements without wiping them.
 *
 * Two class names carry the two floating things: `.parle-pill` is the mark in
 * the corner and `.parle-dock` is the surface it opens. They are the names the
 * markup uses and the names the browser harness reads back, so there is exactly
 * one of each and no aliases.
 *
 * ## Reset
 *
 * Every root gets `all: initial` and then states, explicitly, every property
 * the host page could plausibly have inherited to it. Inside a shadow root that
 * is belt-and-braces; in the popup it is not, and it costs nothing either way.
 * Nothing here inherits from the page it is drawn on.
 *
 * ## Restraint, and what restraint is not allowed to cost
 *
 * There are almost no borders and one shadow, and the shadow is structural — it
 * is what separates the two things floating above the page from the page. Every
 * distinction that was fought for is still drawn, just more quietly:
 *
 * - Linked, Passing and Topical keep three different treatments — an accent
 *   rule, a neutral rule, and no rule at all. There is no arrangement in which
 *   they render alike, which is the visible form of the rule that they are
 *   never blended. The accent is spent on Linked and nowhere else in the list.
 * - The six Tones keep six different inks. What went away is six background
 *   washes; what stayed is that refused, garbled, withheld, waiting, quiet and
 *   found do not look the same. ADR 0011: the words carry the specifics, the
 *   ink only has to stop two states looking identical.
 * - ADR 0006's Citations are underlined always, not on hover. A pointer that
 *   only looks followable once the mouse is on it is one nobody follows. The
 *   selector is `.parle a.parle-source` and the tag in it is load bearing:
 *   `.parle a { text-decoration: none }` in the reset above is (0,1,1), a bare
 *   `.parle-source` is (0,1,0), and for as long as that was the rule the
 *   underline lost every cascade and the citation rendered as grey text
 *   indistinguishable from the sentence under it. The rule said one thing and
 *   the browser drew another, which no unit test on `textContent` can see.
 * - A disputed Finding gets a rule down the left in the *neutral* ink — never
 *   the accent, never a warning colour, never an icon. ADR 0006 records that
 *   readers hear "contested" as "false" and requires the treatment to work
 *   against that.
 * - A restraint is not styled as a failure. Not looking a page up is the
 *   product working, and colouring it like an error teaches the reader to
 *   dismiss the one message that is about their own privacy.
 *
 * Restraint is not allowed to cost a control its edges. `.parle-act` was filled
 * with `--parle-raise` and the Digest card is drawn in `--parle-raise`, so
 * "Connect a Provider" — the only control on that surface — rendered as bold
 * text with no boundary at all. It is now outlined in `--parle-rule` over
 * `--parle-bg`, which reads as a button on either background; `.parle-act-
 * strong` keeps the filled accent, because a first-run choice and an offer to
 * spend the reader's own quota are not the same weight of ask.
 *
 * The same applies to the way out of the surface. A bare `×` in the faintest
 * ink there is reads as a stray character on a 390px screen, not as the one
 * control that closes a full-screen modal, so it sits on a filled circle in the
 * neutral ink.
 *
 * ## The footer, which wraps on purpose or not at all
 *
 * A toolbar popup is 360px wide. Five controls do not fit on one line there,
 * and left to `flex-wrap` the last of them lands alone under the state label
 * looking like an accident — which is exactly how it looked, and was invisible
 * for as long as the popup was photographed as a full-width tab. So the rows
 * are declared in the markup: the switch and the sentence describing its
 * position on one, the three ways out on the next.
 *
 * ## The mark
 *
 * A small stack of Network discs the reader can drag: small enough to ignore,
 * parked by default in the top right where nothing on a reading page lives,
 * carrying a count so the reader knows the size of what is waiting before they
 * open anything. One Network → one disc. Two or three → a short overlapping
 * stack, so the corner of the page says *where* the chatter is before anything
 * opens. The glyphs are inline SVG — no font, no image, no request — and each
 * states its own `fill`, so the `svg:not([fill])` rule never washes them out.
 *
 * It announces itself exactly once. The stack arrives, one ring goes out from
 * it and does not come back, then it sits still. Both animations run a single
 * iteration and end where they began, so there is no state in which this is
 * still moving a second after it appeared. `prefers-reduced-motion` removes
 * both, and loses nothing: the mark's whole job is done by being on the page
 * with a number on it.
 *
 * Position is `left`/`top` rather than `right`, because the reader can park it
 * anywhere; the historic top-right is just the default fractions (1, 0). Drag
 * uses `cursor: grab` and suppresses the click that would otherwise open the
 * surface when the pointer has moved.
 *
 * It is never drawn on nothing. `[hidden]`, a zero count, and an empty count
 * bubble each take it off the page, so a surface that has learned there is
 * nothing to show cannot leave a mark implying otherwise.
 *
 * It carries a hairline as well as the lift. The stack sits on the surface
 * colour, which on a white page is the page's colour, and a soft shadow alone
 * is very nearly nothing — photographed against the white body of an article
 * rather than the grey advertisement at the top of it, where a white circle
 * flatters itself.
 *
 * ## The surface
 *
 * One surface, injected, responsive — one CSS file with no JavaScript branch
 * anywhere in it. ADR 0003 puts Safari and iOS in v1, and Safari has no sidebar
 * API on either macOS or iOS, so a native sidebar would ship to half the
 * platforms as nothing. This shape is the same on all four.
 *
 * Below 640px it is the whole screen with a close button, because a 380px
 * column docked to the edge of a 390px phone is a modal that has been made
 * awkward. At 640px and above it docks right and is capped at
 * `clamp(320px, 30vw, 420px)`, so it reads beside the page rather than over it
 * and does not swallow a wide monitor. `env(safe-area-inset-*)` keeps the close
 * button clear of an iPhone's notch.
 *
 * The surface's `z-index` is one higher than the mark's, and that is load
 * bearing rather than arbitrary: both live in the top right corner, so the open
 * surface paints over the mark and takes its clicks. The mark cannot be left
 * sitting on top of the panel's own close button by a surface that forgot to
 * hide it, because there is no JavaScript involved in hiding it.
 *
 * Both z-indexes are a FALLBACK. The two floating things ask for the top layer
 * — see `raise` in `pill.content.ts` — because a page's own modal `<dialog>`
 * paints above the entire stacking order however large a number we write here.
 * Measured on nature.com, whose cookie banner is exactly that and covered two
 * thirds of the docked surface. Where the top layer is unavailable these
 * numbers are what places them, which is correct everywhere except under a
 * modal, so the rules stay.
 *
 * The popup's body is capped and scrolls under a head that stays put; inside
 * the surface the height is the viewport's, so the cap lifts and the body takes
 * whatever is left. That is the one place the two surfaces differ, and it is a
 * difference in what contains them rather than in what they are.
 *
 * ## One stylesheet, two things drawn in it
 *
 * The page surface draws Discussions and a Digest; the toolbar surface draws
 * the account of every Place, the restraint when there is one, and the switch.
 * They share a head, a body, a footer and every token, which is why one string
 * still makes sense: the reader should not be able to tell that two different
 * files drew them.
 */
export const PANEL_STYLES = `
:host,
.parle, .parle-pill, .parle-dock {
  --parle-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --parle-t-meta: 11px;
  --parle-t-body: 13px;
  --parle-t-lead: 15px;
  --parle-t-head: 18px;
  --parle-1: 4px;
  --parle-2: 8px;
  --parle-3: 12px;
  --parle-4: 16px;
  --parle-5: 24px;
  --parle-r: 10px;
  --parle-r-sm: 6px;
  --parle-r-full: 999px;
  --parle-bg: #ffffff;
  --parle-raise: #f4f5f7;
  --parle-ink: #14161a;
  --parle-mid: #5b6270;
  --parle-faint: #6f7683;
  --parle-line: rgba(20, 22, 26, 0.1);
  --parle-rule: rgba(20, 22, 26, 0.2);
  --parle-accent: #1a6fdb;
  --parle-on-accent: #ffffff;
  --parle-warn: #7a5200;
  --parle-stop: #99291c;
  --parle-lift: 0 1px 2px rgba(10, 12, 16, 0.06), 0 10px 32px rgba(10, 12, 16, 0.14);
  --parle-motion: cubic-bezier(0.2, 0.75, 0.3, 1);
}
@media (prefers-color-scheme: dark) {
  :host,
  .parle, .parle-pill, .parle-dock {
    --parle-bg: #101216;
    --parle-raise: #191c22;
    --parle-ink: #e8eaef;
    --parle-mid: #a2a9b6;
    --parle-faint: #8b929f;
    --parle-line: rgba(232, 234, 239, 0.11);
    --parle-rule: rgba(232, 234, 239, 0.24);
    --parle-accent: #6eb0ff;
    --parle-on-accent: #0a1628;
    --parle-warn: #e0bd76;
    --parle-stop: #f0a396;
    --parle-lift: 0 1px 2px rgba(0, 0, 0, 0.4), 0 10px 32px rgba(0, 0, 0, 0.5);
  }
}

/* the phone scale */
@media (max-width: 639px) {
  :host,
  .parle, .parle-pill, .parle-dock {
    --parle-t-meta: 12px;
    --parle-t-body: 15px;
    --parle-t-lead: 17px;
  }
}

/* reset — nothing inherits from the page this is drawn on */
.parle, .parle-pill, .parle-dock {
  all: initial;
  color-scheme: light dark;
  font-family: var(--parle-font);
  font-size: var(--parle-t-body);
  line-height: 1.5;
  color: var(--parle-ink);
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
}
.parle *, .parle *::before, .parle *::after,
.parle-pill *, .parle-pill::before, .parle-pill::after,
.parle-dock * { box-sizing: border-box; }
.parle a { color: inherit; text-decoration: none; }
.parle :focus-visible,
.parle-pill:focus-visible, .parle-close:focus-visible {
  outline: 2px solid var(--parle-accent);
  outline-offset: 2px;
  border-radius: var(--parle-r-sm);
}

/* the panel */
.parle { display: flex; flex-direction: column; background: var(--parle-bg); }
.parle-head { flex: none; padding: var(--parle-4) var(--parle-4) var(--parle-2); }
.parle-heading {
  margin: 0 0 2px;
  font-size: var(--parle-t-lead);
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parle-address {
  font-size: var(--parle-t-meta);
  color: var(--parle-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parle-body {
  padding: 0 var(--parle-3) var(--parle-3);
  max-height: 420px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.parle-compact { min-height: 0; }
.parle-compact .parle-body {
  padding: 10px 16px 8px;
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
}
.parle-dock .parle { flex: 1 1 auto; min-height: 0; }
.parle-dock .parle-body { max-height: none; flex: 1 1 auto; min-height: 0; }
.parle-dock .parle-compact { height: 100%; }
.parle-main { min-width: 0; }
.parle-extras { margin-top: var(--parle-3); }

/* discussions — Linked room vs Passing list, never blended */
.parle-group { margin: var(--parle-4) 0 0; }
.parle-group:first-child { margin-top: 0; }
.parle-group-name {
  margin: 0 0 var(--parle-2);
  font-size: var(--parle-t-meta);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--parle-mid);
}
.parle-group-note {
  display: block;
  margin-top: 2px;
  font-size: var(--parle-t-meta);
  color: var(--parle-faint);
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}
.parle-group-linked .parle-group-name { color: var(--parle-accent); }
.parle-row {
  display: block;
  padding: var(--parle-2) var(--parle-3);
  margin: 0 0 var(--parle-1);
  border-radius: var(--parle-r-sm);
  background: var(--parle-raise);
  transition: background 160ms var(--parle-motion);
}
.parle-row:hover { background: var(--parle-line); }
.parle-group-passing .parle-row { box-shadow: inset 2px 0 0 var(--parle-rule); }
.parle-title { display: block; font-weight: 500; margin-bottom: 2px; }
.parle a:hover .parle-title { text-decoration: underline; }
.parle-facts {
  display: flex;
  gap: var(--parle-2);
  flex-wrap: wrap;
  font-size: var(--parle-t-meta);
  color: var(--parle-faint);
}
.parle-network { font-weight: 600; color: var(--parle-mid); }
.parle-repeat { font-style: italic; }

/*
 * Compact open room — comments first. Network identity lives on the bottom
 * nav icon; Parle's shell stays neutral. Subtle guides only.
 */
.parle-room { margin: 0; }
.parle-room-title {
  display: -webkit-box;
  margin: 0;
  padding: 2px 0 8px;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--parle-ink);
  font-size: var(--parle-t-body);
  font-weight: 650;
  line-height: 1.35;
}
.parle-room-title:hover { text-decoration: underline; }
.parle-room-repeat {
  padding: 3px 0 5px;
  border-bottom: 1px solid var(--parle-line);
  color: var(--parle-faint);
  font-size: var(--parle-t-meta);
}
.parle-thread-picks {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  margin: 0 0 8px;
  scrollbar-width: none;
}
.parle-thread-picks::-webkit-scrollbar { display: none; }
.parle-thread-pick {
  flex: none;
  max-width: 10em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 0;
  border-radius: 999px;
  padding: 4px 10px;
  background: var(--parle-raise);
  color: var(--parle-mid);
  font: 600 11px/1 var(--parle-font);
  cursor: pointer;
}
.parle-thread-pick-on {
  background: var(--parle-accent);
  color: var(--parle-on-accent);
}

.parle-home .parle-comments {
  margin: 0;
  padding: 0;
  border-left: 0;
}
.parle-home .parle-comment {
  margin: 0;
  padding: 9px 0;
  border-bottom: 1px solid var(--parle-line);
  border-left: 0;
}
.parle-home .parle-comment:last-child { border-bottom: 0; }
.parle-home .parle-replies {
  margin: 7px 0 0;
  padding: 0 0 0 12px;
  border-left: 1.5px solid var(--parle-line);
}
.parle-room[data-network="hackernews"] {
  --parle-guide: #ff6600;
}
.parle-room[data-network="reddit"] {
  --parle-guide: #ff4500;
}
.parle-room[data-network="x"] {
  --parle-guide: #536471;
}
.parle-room[data-network] .parle-replies {
  border-left-color: color-mix(in srgb, var(--parle-guide) 48%, transparent);
}
.parle-room[data-network] .parle-comment-who { color: var(--parle-guide); font-weight: 700; }
.parle-room[data-network="x"] .parle-comment {
  border-left: 0;
  padding-left: 0;
}
.parle-room[data-network="x"] .parle-comment-who {
  color: var(--parle-ink);
  font-weight: 800;
}

/*
 * Bottom nav — ~32px icon row. Counts are iOS-style badges on the icon's
 * top-right and do not add layout height. Settings sits apart on the right.
 */
.parle-nav-slot { flex: none; }
.parle-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: calc(34px + env(safe-area-inset-bottom, 0px));
  padding: 3px 12px calc(3px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--parle-line);
  background: var(--parle-bg);
}
.parle-nav-strip {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.parle-nav-strip::-webkit-scrollbar { display: none; }
.parle-nav-item {
  position: relative;
  flex: none;
  width: 40px;
  height: 27px;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--parle-mid);
  cursor: pointer;
  padding: 0;
}
.parle-nav-item:hover { background: var(--parle-raise); color: var(--parle-ink); }
.parle-nav-on { color: var(--parle-accent); }
.parle-nav-on::after {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 2px;
  border-radius: 999px;
  background: var(--parle-accent);
}
.parle-nav-icon {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  overflow: visible;
}
.parle-nav-mark,
.parle-tab-mark {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  overflow: hidden;
  color: inherit;
}
.parle-nav-mark svg,
.parle-tab-mark svg { display: block; width: 20px; height: 20px; }
.parle-nav-badge {
  position: absolute;
  top: -5px;
  right: -9px;
  z-index: 1;
  min-width: 12px;
  height: 12px;
  padding: 0 2.5px;
  border-radius: 999px;
  background: #ff3b30;
  color: #ffffff;
  font: 700 8px/12px var(--parle-font);
  font-variant-numeric: tabular-nums;
  text-align: center;
  box-shadow: 0 0 0 1.5px var(--parle-bg);
  pointer-events: none;
}
.parle-nav-soon {
  position: absolute;
  top: -3px;
  right: -4px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--parle-accent);
  box-shadow: 0 0 0 1.5px var(--parle-bg);
  pointer-events: none;
}
.parle-nav-utilities {
  display: flex;
  align-items: center;
  flex: none;
  margin-left: 4px;
  padding-left: 5px;
  box-shadow: -1px 0 0 var(--parle-line);
}
.parle-nav-settings { width: 32px; color: var(--parle-mid); }
.parle-nav-settings svg { display: block; width: 16px; height: 16px; }
.parle-nav-settings::after { display: none; }

/* A Discussion's own words. */
.parle-open {
  border: 0; background: transparent; cursor: pointer; font: inherit;
  color: var(--parle-accent); padding: 0; text-decoration: underline;
}
.parle-comments {
  margin: var(--parle-1) 0 var(--parle-2) var(--parle-2);
  padding-left: var(--parle-2);
  border-left: 2px solid var(--parle-line);
}
.parle-comments-tools {
  display: flex; align-items: center; gap: var(--parle-3);
  min-height: 32px;
  margin-bottom: 0;
  border-bottom: 1px solid var(--parle-line);
}
.parle-comments-mode, .parle-comments-collapse, .parle-comment-more, .parle-comments-more,
.parle-comments-open {
  border: 0; background: transparent; cursor: pointer; font: inherit;
  color: var(--parle-accent); padding: 0; text-decoration: none;
  font-size: var(--parle-t-meta); font-weight: 600;
}
.parle-comments-mode {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  color: var(--parle-ink);
}
.parle-comments-mode svg { display: block; width: 15px; height: 15px; color: var(--parle-mid); }
.parle-comments-chevron { color: var(--parle-faint); font-size: 10px; transform: translateY(-1px); }
.parle-comments-collapse { color: var(--parle-accent); font-weight: 500; }
.parle-comments-collapse:hover { color: var(--parle-ink); }
.parle-comments-spacer { flex: 1 1 auto; }
.parle-comments-open,
.parle-comments-more-actions {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  color: var(--parle-mid);
}
.parle-comments-open:hover,
.parle-comments-more-actions:hover { color: var(--parle-ink); }
.parle-comments-open svg,
.parle-comments-more-actions svg { display: block; width: 14px; height: 14px; }
.parle-comments-menu-wrap { position: relative; display: inline-grid; }
.parle-comments-menu {
  position: absolute;
  z-index: 2;
  top: 26px;
  right: 0;
  min-width: 150px;
  padding: 4px;
  border: 1px solid var(--parle-line);
  border-radius: 8px;
  background: var(--parle-bg);
  box-shadow: var(--parle-lift);
}
.parle-comments-menu[hidden] { display: none; }
.parle-comments-menu-item {
  display: block;
  width: 100%;
  border: 0;
  border-radius: 5px;
  padding: 6px 8px;
  background: transparent;
  color: var(--parle-ink);
  font: 500 var(--parle-t-meta)/1.3 var(--parle-font);
  text-align: left;
  cursor: pointer;
}
.parle-comments-menu-item:hover { background: var(--parle-raise); }
.parle-comments-more { margin: var(--parle-1) 0 var(--parle-2); text-decoration: underline; }
.parle-comment { margin-bottom: var(--parle-2); min-width: 0; }
.parle-comment-who { color: var(--parle-mid); font-size: var(--parle-t-meta); }
.parle-comment-age { margin-left: var(--parle-1); color: var(--parle-faint); font-weight: 400; }
.parle-comment-text {
  margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere;
  line-height: 1.45;
}
.parle-comment-more {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 22px;
  margin-top: 2px;
  font-size: var(--parle-t-meta);
  color: var(--parle-mid);
}
.parle-comment-more::before {
  content: "›";
  font-size: 14px;
  line-height: 1;
  color: var(--parle-guide, var(--parle-faint));
}
.parle-replies {
  margin: var(--parle-2) 0 0 var(--parle-2);
  padding-left: var(--parle-2);
  border-left: 2px solid var(--parle-line);
}
.parle-comments-note { color: var(--parle-mid); font-size: var(--parle-t-meta); margin: 0; }

/* a site's front door: what was set aside, and the one click that opens it.
   Quiet rather than warning-coloured — nothing has gone wrong here, and the
   product's own rule is that a suppression must read as a decision the reader
   can reverse rather than as an error they have to interpret. */
.parle-folded {
  margin: var(--parle-3) 0 0;
  padding: var(--parle-3);
  border-radius: var(--parle-r-sm);
  background: var(--parle-raise);
}
.parle-folded-says {
  margin: 0 0 var(--parle-2);
  font-size: var(--parle-t-meta);
  color: var(--parle-mid);
}
.parle-act-folded { font-size: var(--parle-t-meta); padding: var(--parle-1) var(--parle-3); }
.parle-folded-rows { margin-top: var(--parle-2); }
.parle-folded-rows .parle-row { background: var(--parle-bg); }

/* tones — six states, six inks, no washes (ADR 0011) */
.parle-tone-refused { color: var(--parle-stop); }
.parle-tone-garbled { color: var(--parle-warn); }
.parle-tone-withheld, .parle-tone-waiting, .parle-tone-quiet { color: var(--parle-mid); }
.parle-tone-found { color: var(--parle-accent); }
.parle-notice {
  display: flex;
  justify-content: space-between;
  gap: var(--parle-2);
  margin: var(--parle-2) 0 0;
  padding: var(--parle-2) var(--parle-3);
  border-radius: var(--parle-r-sm);
  background: var(--parle-raise);
  font-size: var(--parle-t-meta);
}
.parle-said { margin: var(--parle-3) 0; color: var(--parle-mid); }
.parle-restraint { margin: var(--parle-3) 0 var(--parle-4); color: var(--parle-mid); }
.parle-restraint-says { margin: 0 0 var(--parle-3); color: var(--parle-ink); }

/* actions — outlined, so a button is a button on whatever it sits on */
.parle-act {
  all: unset;
  display: inline-block;
  cursor: pointer;
  font-family: var(--parle-font);
  font-size: var(--parle-t-body);
  font-weight: 550;
  padding: var(--parle-2) var(--parle-4);
  border-radius: var(--parle-r-full);
  color: var(--parle-ink);
  background: var(--parle-bg);
  box-shadow: inset 0 0 0 1px var(--parle-rule);
  transition: background 160ms var(--parle-motion), opacity 160ms var(--parle-motion);
}
.parle-act:hover { background: var(--parle-raise); }
.parle-act-strong {
  background: var(--parle-accent);
  color: var(--parle-on-accent);
  box-shadow: none;
}
.parle-act-strong:hover { background: var(--parle-accent); opacity: 0.88; }
.parle-link {
  all: unset;
  cursor: pointer;
  font-family: var(--parle-font);
  font-size: var(--parle-t-meta);
  color: var(--parle-mid);
  transition: color 160ms var(--parle-motion);
}
.parle-link:hover { color: var(--parle-ink); text-decoration: underline; }
.parle-note { margin: var(--parle-4) 0 0; font-size: var(--parle-t-meta); color: var(--parle-mid); }
/* the footer — rows declared, never wrapped into */
.parle-footer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--parle-2);
  border-top: 1px solid var(--parle-line);
  padding: var(--parle-3) var(--parle-4);
  font-size: var(--parle-t-meta);
  color: var(--parle-faint);
}
.parle-footer-row {
  display: flex;
  align-items: center;
  gap: var(--parle-3);
  flex-wrap: wrap;
}
.parle-footer-state { margin-right: auto; color: var(--parle-mid); }

/* the account of every place we asked — the toolbar surface's whole job */
.parle-coverage { margin: var(--parle-4) 0 0; }
.parle-coverage-name {
  margin: 0 0 var(--parle-1);
  font-size: var(--parle-t-meta);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--parle-faint);
}
.parle-account {
  display: flex;
  justify-content: space-between;
  gap: var(--parle-3);
  padding: var(--parle-1) 0;
  font-size: var(--parle-t-meta);
  color: var(--parle-mid);
}
.parle-account-place { color: var(--parle-mid); }
.parle-account-waiting { color: var(--parle-faint); }
.parle-account-refused { color: var(--parle-stop); }
.parle-account-garbled { color: var(--parle-warn); }
.parle-account-found { color: var(--parle-accent); }

/* digest */
.parle-digest {
  margin: var(--parle-4) 0 0;
  padding: var(--parle-3);
  border-radius: var(--parle-r);
  background: var(--parle-raise);
  color: var(--parle-mid);
}
.parle-compact .parle-digest { margin-top: 0; }
.parle-digest-title { margin: 0 0 var(--parle-2); font-size: var(--parle-t-body); font-weight: 600; color: var(--parle-ink); }
.parle-digest-says { margin: 0 0 var(--parle-2); }
.parle-digest-partial { margin: var(--parle-2) 0 0; font-size: var(--parle-t-meta); }
.parle-digest-wrote { margin: var(--parle-2) 0 0; font-size: var(--parle-t-meta); color: var(--parle-faint); }
.parle-act-digest { margin-top: var(--parle-1); }
.parle-finding { margin: 0 0 var(--parle-3); }
.parle-finding:last-of-type { margin-bottom: 0; }
.parle-finding-says { margin: 0 0 var(--parle-1); color: var(--parle-ink); }
/* disputed: the neutral ink, never the accent and never a warning (ADR 0006) */
.parle-finding-disputed { box-shadow: inset 2px 0 0 var(--parle-rule); padding-left: var(--parle-3); }
.parle-disputed {
  display: block;
  margin-bottom: 2px;
  font-size: var(--parle-t-meta);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--parle-faint);
}
/* citations: underlined always, because they are meant to be followed (ADR 0006) */
.parle-sources { display: flex; flex-wrap: wrap; gap: var(--parle-1) var(--parle-3); }
.parle a.parle-source {
  font-size: var(--parle-t-meta);
  color: var(--parle-mid);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  cursor: pointer;
}
.parle a.parle-source:hover { color: var(--parle-ink); }
.parle-spinner {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: var(--parle-r-full);
  background: currentColor;
  margin-right: var(--parle-2);
  vertical-align: middle;
  animation: parle-pulse 1.4s var(--parle-motion) infinite;
}
@keyframes parle-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }

/* the mark — parked by the reader, only when there is something, still after it arrives */
.parle-pill {
  position: fixed;
  top: var(--parle-4);
  left: auto;
  right: var(--parle-4);
  z-index: 2147483646;
  display: grid;
  place-items: center;
  min-width: 36px;
  height: 36px;
  padding: 4px;
  border: 0;
  border-radius: var(--parle-r-full);
  background: var(--parle-bg);
  color: var(--parle-ink);
  box-shadow: var(--parle-lift), inset 0 0 0 1px var(--parle-line);
  cursor: grab;
  touch-action: none;
  user-select: none;
  font-family: var(--parle-font);
  font-size: var(--parle-t-meta);
  font-weight: 650;
  transition: transform 160ms var(--parle-motion), box-shadow 160ms var(--parle-motion);
  animation: parle-arrive 420ms var(--parle-motion) both;
}
.parle-pill:hover { transform: scale(1.05); }
.parle-pill[data-dragging="1"] {
  cursor: grabbing;
  transform: scale(1.08);
  box-shadow: var(--parle-lift), inset 0 0 0 1px var(--parle-accent);
  transition: none;
}
.parle-pill[hidden], .parle-pill[data-found="0"] { display: none; }
.parle-pill svg, .parle-close svg { display: block; width: 16px; height: 16px; }
.parle-pill svg:not([fill]), .parle-close svg:not([fill]) { fill: currentColor; }
.parle-stack {
  display: flex;
  flex-direction: row;
  align-items: center;
}
.parle-stack-disc {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--parle-r-full);
  background: var(--parle-bg);
  box-shadow: 0 0 0 2px var(--parle-bg);
  overflow: hidden;
}
.parle-stack-disc + .parle-stack-disc { margin-left: -10px; }
.parle-stack-disc svg { width: 28px; height: 28px; }
.parle-stack-parle {
  color: var(--parle-ink);
  background: var(--parle-raise);
}
.parle-stack-parle svg { width: 16px; height: 16px; }
.parle-pill-count {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--parle-r-full);
  background: var(--parle-accent);
  color: var(--parle-on-accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--parle-bg);
}
.parle-pill-count:empty { display: none; }
/* the announcement: one ring, outward, once */
.parle-pill::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: var(--parle-r-full);
  border: 2px solid var(--parle-accent);
  pointer-events: none;
  animation: parle-ring 1100ms var(--parle-motion) 1 both;
}
@keyframes parle-arrive {
  from { opacity: 0; transform: translateY(-6px) scale(0.8); }
  to { opacity: 1; transform: none; }
}
@keyframes parle-ring {
  from { opacity: 0.55; transform: scale(1); }
  to { opacity: 0; transform: scale(2.1); }
}

/* the surface — full screen under 640px, docked right at and above it */
.parle-dock {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  background: var(--parle-bg);
  box-shadow: var(--parle-lift);
  overscroll-behavior: contain;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  animation: parle-open 180ms var(--parle-motion) both;
}
@keyframes parle-open { from { opacity: 0; } to { opacity: 1; } }
@media (min-width: 640px) {
  .parle-dock { inset: 0 0 0 auto; width: clamp(320px, 30vw, 420px); padding-bottom: 0; }
}
/* the way out of the surface, drawn as a button */
.parle-close {
  all: unset;
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + var(--parle-2));
  right: var(--parle-2);
  z-index: 1;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--parle-r-full);
  background: var(--parle-raise);
  cursor: pointer;
  font-family: var(--parle-font);
  font-size: var(--parle-t-head);
  line-height: 1;
  color: var(--parle-mid);
  transition: background 160ms var(--parle-motion), color 160ms var(--parle-motion);
}
.parle-close:hover { background: var(--parle-line); color: var(--parle-ink); }
.parle-dock .parle-head { padding-right: 52px; }
@media (max-width: 639px) {
  .parle-close {
    top: calc(env(safe-area-inset-top, 0px) + var(--parle-3));
    right: var(--parle-3);
    width: 40px;
    height: 40px;
  }
  .parle-dock .parle-head { padding-right: 64px; padding-top: var(--parle-5); }
  .parle-dock .parle-heading {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
}

@media (prefers-reduced-motion: reduce) {
  .parle, .parle *,
  .parle-pill, .parle-pill::after,
  .parle-dock, .parle-close { animation: none !important; transition: none !important; }
  .parle-pill::after { opacity: 0; }
}
`
