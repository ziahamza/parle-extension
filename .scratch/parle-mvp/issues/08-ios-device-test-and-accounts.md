# Establish what a Safari extension can actually do on an iPhone, and get the store accounts

Type: task
Status: open

## Question

Nothing to decide — but several decisions are resting on assumptions about iOS that have not been verified on hardware, and [ADR 0003](../../../docs/adr/0003-platform-targets.md) puts iOS in v1 alongside Chrome. Ship a hello-world Safari Web Extension to a real iPhone and find out.

**Provision first:**
- Paid Apple Developer account. Confirm the 2026 path: a standards-based WebExtension uploads to App Store Connect as a ZIP with **no Mac and no Xcode** — verify this end to end, including TestFlight.
- Chrome Web Store developer account.

**Then measure, on device:**
- Does `action.setBadgeText` render anything visible on iPhone? Unresolved during charting — the docs are ambiguous and it decides how much weight the pill carries versus the toolbar ([ADR 0003](../../../docs/adr/0003-platform-targets.md)).
- What is the toolbar entry point on iPhone, and how many taps to the panel?
- Does content-script injection into a Shadow DOM behave as on desktop?
- **Background execution**: do `alarms` fire when Safari is backgrounded, or only in the foreground? This decides whether [ADR 0012](../../../docs/adr/0012-local-discussion-cache-built-from-browsing.md)'s scheduled prefetch exists on iOS at all.
- IndexedDB storage ceiling for an extension, and eviction behaviour under pressure — this is the number ticket 02 must size against.
- Per-site permission model: what does the reader have to grant, how often, and what does a Lookup do before permission exists?
- Cookie access: does a `fetch` from the extension carry the user's `reddit.com` / `x.com` cookies as it does on Chrome? If not, tickets 01 and [ADR 0001](../../../docs/adr/0001-x-access-via-user-session.md) are both wrong on iOS.

**The result:** a written capability matrix for iOS versus Chrome, plus the accounts needed to submit.
