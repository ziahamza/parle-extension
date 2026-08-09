import { defineConfig } from "wxt"

/**
 * MV3 on every target, including Safari and Firefox.
 *
 * WXT defaults those two to MV2; ADR 0003 overrides that so there is one
 * manifest model rather than two, and a background *service worker* rather than
 * a background page whose lifetime rules differ. `manifestVersion: 3` is the
 * whole of that override.
 *
 * Auto-imports are off. The repo's house style is deep imports with `.ts`
 * specifiers, and an implicit global `browser` would defeat ADR 0003's
 * "no direct `chrome.*` calls anywhere" by making the call site invisible —
 * `src/platform/*` is the only place allowed to touch the extension APIs, and
 * an explicit import is what makes that reviewable with grep.
 */
export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
  imports: false,
  vite: () => ({
    define: {
      // ADR 0001's compile-out flag, as a literal so the bundler can fold it.
      // `@parle/networks`' X connector reads `__PARLE_X__` through a guarded
      // `typeof` check; folding it to `false` makes the branch that would issue
      // an authenticated request against the reader's own X account
      // unreachable, and therefore droppable from the artifact. An environment
      // variable would leave the code in the bundle and turn a property anyone
      // can verify by reading the file into a promise they have to take on
      // trust.
      __PARLE_X__: "false"
    }
  }),
  manifest: ({ browser }) => ({
    name: "Parle",
    // Names the two Networks this artifact actually contacts, not the three
    // Parle asks by design. ADR 0001 compiles X out, and a store listing that
    // named it would be checkably wrong about the same thing the first-run
    // screen and the settings page are careful to get right.
    description:
      "See what Hacker News and Reddit have already said about the page you are reading.",
    version: "0.0.1",
    // `tabs` for the address of the top frame — the Reading boundary lives in
    // the background, so no content script has to be present on every page the
    // reader opens just to report where they are. `scripting` so the pill is
    // injected only where there is something to show.
    //
    // `storage` is deliberately NOT requested. One thing in this build is
    // written to disk — the reader's own settings, so that a per-site pause is
    // not something they have to keep making — and it goes through the byte
    // store `@parle/browser` provides, which is the Cache API and needs no
    // permission at all. Nothing about what they READ is stored. A permission
    // asked for and never used is one a store reviewer has to take our word
    // about.
    //
    // `webNavigation` is what `@parle/browser`'s ReadingWatch prefers: it
    // reports in-page and fragment navigations that `tabs.onUpdated` does not,
    // which is the difference between noticing a single-page app change article
    // and not. It is optional by design — Safari on iOS does not reliably grant
    // it and the adapter falls back to `tabs.onUpdated`, which sees fewer
    // boundaries but never zero.
    //
    // Host permissions are NOT declared here: WXT derives `http://*/*` and
    // `https://*/*` from the pill's match patterns, and that is exactly the
    // reach this needs — enough to inject the pill and to reach the two
    // Networks whose Lookups run against the reader's own browser session,
    // and no more. `<all_urls>` would additionally cover `file://` and
    // `ftp://`, which no Lookup will ever be issued for.
    permissions: ["tabs", "scripting", "webNavigation"],
    action: { default_title: "Parle" },
    // Firefox rejects an MV3 build with no extension id. Chrome and Safari
    // ignore the key, so it is set only where it is load-bearing.
    ...(browser === "firefox"
      ? { browser_specific_settings: { gecko: { id: "parle@parle.dev" } } }
      : {})
  })
})
