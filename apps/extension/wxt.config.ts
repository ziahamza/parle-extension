import { readFileSync } from "node:fs"

import { defineConfig } from "wxt"

/** `wxt.config.ts` runs in Node; the app's tsconfig sets `types: []`, so say so. */
declare const process: { readonly env: Record<string, string | undefined> }

const STORE_SUMMARY = readFileSync(new URL("../../store/summary.txt", import.meta.url), "utf8").trimEnd()
const APPLE_MANIFEST_DESCRIPTION = readFileSync(
  new URL("../../store/apple/manifest-description.txt", import.meta.url),
  "utf8"
).trimEnd()

/**
 * The published item's public key — OPTIONAL, and NOT part of the store upload.
 *
 * The Chrome Web Store does not want this and does not need it: the store holds
 * the key pair for item `bbigpojahnmkdbdnbcmadnhbjlemibom` and derives the
 * extension id from its own copy. A zip with no `key` at all uploads fine, and
 * that is what ships — `PUBLISHED_PUBLIC_KEY` is empty here on purpose.
 *
 * It exists for the other direction. An unpacked build loaded from disk gets an
 * id derived from the *directory path* unless the manifest pins a `key`, so a
 * local build is some other extension with some other id. That matters for one
 * thing in this codebase: the Codex Provider's "Log in with ChatGPT" flow, whose
 * only shape available to a Chrome extension is
 * `identity.launchWebAuthFlow` against `https://<extension-id>.chromiumapp.org/`
 * (ADR 0014). That redirect is derived from the id and has to be registered, so
 * a local build with a different id cannot complete a flow registered for the
 * published one. Pin the key and the local build IS the published id.
 *
 * To fill it in: Developer Dashboard → the item → **Package** → *View public
 * key*. Chrome shows a PEM block. Paste the whole thing, armour and newlines
 * included — `publicKeyFor` strips both. Or leave this empty and pass it as
 * `PARLE_CHROME_KEY` for one command, which is the better habit, because a key
 * that is never in the file is a key that can never be in the upload.
 *
 * Chrome only. Firefox derives its id from `browser_specific_settings` and
 * Safari from the containing app's bundle id; `key` means nothing to either, and
 * an unknown top-level manifest field is a warning waiting to be filed by a
 * reviewer of a store we have not submitted to yet.
 */
const PUBLISHED_PUBLIC_KEY = ""

/** PEM armour off, whitespace out — what Chrome wants is the bare base64 DER. */
const publicKeyFor = (raw: string): string => {
  const key = raw.replace(/-----(?:BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "")
  if (key !== "" && !/^[A-Za-z0-9+/]+={0,2}$/.test(key)) {
    throw new Error(
      "Extension key is not base64. Expected the body of the PEM block from the " +
        "Chrome Web Store's Package tab (\"View public key\"), not a private key, " +
        "a .crx, or a fingerprint. Got: " + raw.trim().slice(0, 32) + "…"
    )
  }
  return key
}

const chromeKey = publicKeyFor(PUBLISHED_PUBLIC_KEY || process.env["PARLE_CHROME_KEY"] || "")

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
    /**
     * Emit imported JSON as `JSON.parse("…")` rather than as object literals.
     *
     * Vite's `auto` default already does this for a file this size, and it is
     * pinned rather than left implicit because one import here is large and the
     * threshold is not ours: `@parle/standing`'s compiled ratings are 183 KB of
     * JSON that every reader downloads and the background worker parses at
     * start. `JSON.parse` on one string is materially faster than evaluating the
     * equivalent nested literals, and ADR 0003 makes iOS — tighter memory, colder
     * starts — the platform that decides it. Measured: 350 KB in the emitted
     * chunk either way today; what this pins is that a Vite default change
     * cannot quietly make it slower to start.
     */
    json: { stringify: true },
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
    // Chrome renders this package field as the store's read-only Summary. Keep
    // it equal to `store/summary.txt` after its trailing newline is removed:
    // `store/check-release.ts` checks
    // the built zip so a dashboard runbook cannot promise a summary that the
    // package will never publish. X remains absent because ADR 0001 compiles it
    // out. The second sentence carries the disclosure within Chrome's 132
    // character limit.
    // App Store validation applies Safari's smaller 112-character manifest
    // limit. Chrome keeps the canonical 132-character store Summary; Safari
    // uses its own checked-in disclosure without changing the Chrome package.
    description: browser === "safari" ? APPLE_MANIFEST_DESCRIPTION : STORE_SUMMARY,
    // NOT set here. WXT reads the version from `apps/extension/package.json`,
    // and that is deliberately the only place it is written down.
    //
    // It used to be a literal on this line while `package.json` still said
    // `0.0.0`, which meant `wxt zip` named its artifact
    // `parleextension-0.0.0-chrome.zip` — a filename that disagreed with the
    // manifest inside it, and one that every workflow then had to hard-code.
    // A release that is triggered by the version changing cannot afford two
    // answers to "what version is this?", so there is now one.
    //
    // The store requires each upload to be strictly greater than the version
    // already on the item. The old MV2 item was `2.90`; the revival was
    // submitted as `3.0.0`. Bump with `pnpm version:bump <version>`.
    // `tabs` for the address of the top frame — the Reading boundary lives in
    // the background, so no content script has to be present on every page the
    // reader opens just to report where they are. `scripting` so the pill is
    // injected only where there is something to show.
    //
    // `storage` is deliberately NOT requested. Reader settings go through the
    // byte store `@parle/browser` provides, which is the Cache API and needs no
    // permission. Safari alone also mirrors the explicit openings of Parle
    // into its containing app: `nativeMessaging` crosses that platform-owned
    // seam, and the app keeps at most 100 page-and-discussion snapshots for 30
    // days in an App Group on this device. Chrome and Firefox never receive
    // that permission or native mirror. A permission asked for and never used
    // is one a store reviewer has to take our word about.
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
    // reach this needs — enough to inject the pill and to reach every Network
    // a Lookup goes to, and no more. `<all_urls>` would additionally cover
    // `file://` and `ftp://`, which no Lookup will ever be issued for.
    //
    // That derived grant is what covers `https://lobste.rs/*`, which is the one
    // endpoint in the build that REQUIRES a host permission: it sends no
    // `access-control-allow-origin` at all, so the background fetch would be
    // blocked without one. `public.api.bsky.app` and `lemmy.world` answered
    // CORS-open to an extension origin and need it only for the ordinary MV3
    // reason. Adding a `host_permissions` array naming the three would not
    // narrow anything — the pill's `https://*/*` already covers them and cannot
    // be removed while the pill exists — it would only add a second, weaker
    // statement for a reviewer to have to reconcile with the first. The list of
    // hosts a Lookup may reach is in `app/Client.ts`'s `keyOf`, which is where
    // it is enforceable; `lemm.ee` and `lemmy.ml` are recognised by Harvest and
    // are never asked.
    //
    // The same derived grant covers the two enrichment hosts — `archive.org`,
    // `web.archive.org` and `en.wikipedia.org` — and neither needs it for CORS:
    // both Archive endpoints answered CORS-open, and MediaWiki serves the
    // headers when `origin=*` is named, which `@parle/backlinks` always does.
    // They are named here so that everywhere an address can go is enumerable
    // from this file, and they are enforced in `keyOf` alongside the rest.
    // `web.archive.org` is additionally the one host this build ever NAVIGATES a
    // reader to, and only when they have turned that setting on themselves.
    permissions: [
      "tabs",
      "scripting",
      "webNavigation",
      ...(browser === "safari" ? ["nativeMessaging" as const] : [])
    ],
    action: { default_title: "Parle" },
    // Firefox rejects an MV3 build with no extension id. Chrome and Safari
    // ignore `browser_specific_settings` entirely, so it is set only where it is
    // load-bearing. (Chrome's own id comes from `key`, immediately below, and
    // only for an unpacked build.)
    ...(browser === "firefox"
      ? { browser_specific_settings: { gecko: { id: "parle@parle.dev" } } }
      : {}),
    // Empty unless a human supplied one, and never on any target but Chrome.
    // See `PUBLISHED_PUBLIC_KEY` above for why this is a development affordance
    // rather than a store requirement.
    ...(browser === "chrome" && chromeKey !== "" ? { key: chromeKey } : {})
  })
})
