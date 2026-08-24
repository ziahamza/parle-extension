/**
 * The settings page's stylesheet.
 *
 * Separate from `styles.ts` on purpose. That one is a string because it has to
 * be adopted into a Shadow DOM on a page we have never seen, and every rule in
 * it is defensive. This page is our own document, so it can be an ordinary
 * stylesheet — and keeping the two apart means the bytes that defend the mark
 * are not carrying a settings page around with them into every reader's page.
 *
 * The two files share a vocabulary rather than a stylesheet: the same token
 * names, the same four type sizes, the same accent, the same motion curve. That
 * is what makes the panel and this page read as one product without either one
 * paying for the other's rules.
 *
 * Both colour schemes are written out rather than left to the browser. An
 * extension page that is white in a dark browser reads as a page that was not
 * finished, which is the last impression the one screen carrying the product's
 * disclosure should give.
 */
export const SETTINGS_STYLES = `
:root {
  color-scheme: light dark;

  --parle-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --parle-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --parle-t-meta: 12px;
  --parle-t-body: 14px;
  --parle-t-lead: 15px;
  --parle-t-head: 22px;

  --parle-1: 4px;
  --parle-2: 8px;
  --parle-3: 12px;
  --parle-4: 16px;
  --parle-5: 24px;
  --parle-6: 40px;

  --parle-r: 10px;
  --parle-r-sm: 6px;

  --parle-bg: #ffffff;
  --parle-raise: #f6f4ef;
  --parle-ink: #15130f;
  --parle-mid: #5c574e;
  --parle-faint: #726c62;
  --parle-line: rgba(21, 19, 15, 0.10);
  --parle-rule: rgba(21, 19, 15, 0.20);
  --parle-accent: #15130f;
  --parle-stop: #99291c;

  --parle-motion: cubic-bezier(0.2, 0.75, 0.3, 1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --parle-bg: #0d0e11;
    --parle-raise: #16181d;
    --parle-ink: #edeef2;
    --parle-mid: #9aa0ad;
    --parle-faint: #8b93a1;
    --parle-line: rgba(237, 238, 242, 0.1);
    --parle-rule: rgba(237, 238, 242, 0.24);
    --parle-accent: #edeef2;
    --parle-stop: #f0a396;
  }
}

html, body { margin: 0; padding: 0; background: var(--parle-bg); }

.parle-settings {
  font-family: var(--parle-font);
  font-size: var(--parle-t-body);
  line-height: 1.6;
  color: var(--parle-ink);
  max-width: 42rem;
  margin: 0 auto;
  padding: var(--parle-6) var(--parle-5) 96px;
  box-sizing: border-box;
  accent-color: var(--parle-accent);
  -webkit-font-smoothing: antialiased;
}
.parle-settings *, .parle-settings *::before, .parle-settings *::after { box-sizing: border-box; }

.parle-title {
  font-size: var(--parle-t-head);
  font-weight: 650;
  letter-spacing: -0.02em;
  margin: 0 0 var(--parle-3);
}
.parle-says { margin: 0 0 var(--parle-3); }
.parle-quiet { color: var(--parle-mid); font-size: var(--parle-t-meta); margin: 0 0 var(--parle-1); }

.parle-disclosure {
  background: var(--parle-raise);
  border-radius: var(--parle-r);
  padding: var(--parle-4) var(--parle-4) var(--parle-2);
}

/*
 * The sentences a reader is entitled to hold us to: what the list cannot do,
 * what a Digest costs, where a key really lives. A rule down the left in the
 * accent and nothing else — not a warning about a fault, the lines we most
 * want read. Nothing else on the page wears it, so the mark keeps meaning
 * something.
 */
.parle-honest {
  box-shadow: inset 2px 0 0 var(--parle-accent);
  padding-left: var(--parle-3);
  color: var(--parle-ink);
}

.parle-notice-line {
  margin: var(--parle-3) 0 0;
  padding: var(--parle-2) var(--parle-3);
  border-radius: var(--parle-r-sm);
  background: var(--parle-raise);
  color: var(--parle-accent);
  font-size: var(--parle-t-meta);
}

.parle-section { margin: var(--parle-6) 0 0; }
.parle-section-title {
  font-size: var(--parle-t-meta);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--parle-faint);
  margin: 0 0 var(--parle-3);
}
.parle-sub-title { font-size: var(--parle-t-lead); font-weight: 650; margin: var(--parle-5) 0 var(--parle-2); }

.parle-toggle { padding: var(--parle-3) 0; }
.parle-toggle + .parle-toggle { border-top: 1px solid var(--parle-line); }
.parle-toggle-line { display: flex; align-items: center; gap: var(--parle-2); cursor: pointer; }
.parle-toggle-label { font-weight: 600; }
.parle-toggle-says {
  margin: var(--parle-1) 0 0 var(--parle-5);
  color: var(--parle-mid);
  font-size: var(--parle-t-meta);
}
.parle-toggle-off { opacity: 0.55; }
.parle-toggle-off .parle-toggle-line { cursor: default; }

/*
 * The long version of the disclosure, closed by default.
 *
 * Styled as a quiet line rather than a panel: it is the detail a reader goes
 * looking for, not something the page argues with them about. Everything in it
 * is in the DOM whether or not it is open, so find-in-page still reaches it.
 */
.parle-longer { margin: var(--parle-2) 0 var(--parle-3); }
.parle-longer summary {
  cursor: pointer;
  font-size: var(--parle-t-meta);
  color: var(--parle-mid);
}
.parle-longer summary:hover { color: var(--parle-ink); }
.parle-longer .parle-sub-title { margin: var(--parle-3) 0 var(--parle-1); }
.parle-plain { list-style: none; margin: 0; padding: 0; }
.parle-plain-item {
  padding: var(--parle-2) 0;
  color: var(--parle-mid);
  font-size: var(--parle-t-meta);
}
.parle-plain-item + .parle-plain-item { border-top: 1px solid var(--parle-line); }

.parle-rules { margin: var(--parle-3) 0 var(--parle-1); }

.parle-built-in {
  margin: var(--parle-3) 0;
  background: var(--parle-raise);
  border-radius: var(--parle-r-sm);
  padding: var(--parle-2) var(--parle-3);
}
.parle-built-in summary { cursor: pointer; font-weight: 600; }
.parle-category { margin: var(--parle-3) 0 0; }
.parle-category-title { font-size: var(--parle-t-meta); margin: 0 0 2px; font-weight: 650; }
.parle-category-domains {
  margin: 0;
  color: var(--parle-mid);
  font-size: var(--parle-t-meta);
  word-break: break-word;
}

.parle-sites { list-style: none; margin: 0 0 var(--parle-2); padding: 0; }
.parle-site {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--parle-3);
  padding: var(--parle-2) 0;
}
.parle-site + .parle-site { border-top: 1px solid var(--parle-line); }
.parle-site-name { word-break: break-all; }
.parle-empty-line { color: var(--parle-mid); margin: 0 0 var(--parle-2); font-size: var(--parle-t-meta); }

.parle-adder { margin: var(--parle-2) 0 var(--parle-1); }
.parle-adder-label { display: block; font-size: var(--parle-t-meta); font-weight: 600; }
.parle-adder-box {
  display: block;
  width: 100%;
  margin: var(--parle-2) 0 0;
  padding: var(--parle-2) var(--parle-3);
  font: inherit;
  color: var(--parle-ink);
  background: var(--parle-bg);
  border: 1px solid var(--parle-rule);
  border-radius: var(--parle-r-sm);
  transition: border-color 160ms var(--parle-motion);
}
.parle-adder-box:focus { outline: none; border-color: var(--parle-accent); }
.parle-adder-hint { margin: var(--parle-1) 0 var(--parle-2); color: var(--parle-mid); font-size: var(--parle-t-meta); }

/*
 * One action shape across the whole product.
 *
 * The panel's buttons are pills; these were 6px chips, and the first-run
 * screen's were 8px. Three radii for one gesture is three designers, and a
 * reader moving from the mark to this page should not be able to tell that two
 * stylesheets drew them.
 */
.parle-action {
  font: inherit;
  font-size: var(--parle-t-meta);
  font-weight: 550;
  padding: var(--parle-2) var(--parle-4);
  border-radius: 999px;
  border: none;
  box-shadow: inset 0 0 0 1px var(--parle-rule);
  background: var(--parle-bg);
  color: var(--parle-ink);
  cursor: pointer;
  transition: background 160ms var(--parle-motion);
}
.parle-action:hover { background: var(--parle-raise); }
.parle-action-loud { color: var(--parle-stop); }
.parle-inline-action {
  font: inherit;
  font-size: var(--parle-t-meta);
  padding: var(--parle-1) var(--parle-3);
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--parle-mid);
  cursor: pointer;
  flex: none;
  transition: background 160ms var(--parle-motion), color 160ms var(--parle-motion);
}
.parle-inline-action:hover { color: var(--parle-ink); background: var(--parle-raise); }

.parle-settings :focus-visible {
  outline: 2px solid var(--parle-accent);
  outline-offset: 2px;
  border-radius: var(--parle-r-sm);
}

.parle-forget { padding: var(--parle-3) 0; }
.parle-forget + .parle-forget { border-top: 1px solid var(--parle-line); }

.parle-foot {
  margin: var(--parle-6) 0 0;
  padding-top: var(--parle-4);
  border-top: 1px solid var(--parle-line);
  color: var(--parle-mid);
  font-size: var(--parle-t-meta);
}

@media (prefers-reduced-motion: reduce) {
  .parle-settings *, .parle-settings { transition: none !important; animation: none !important; }
}
`
