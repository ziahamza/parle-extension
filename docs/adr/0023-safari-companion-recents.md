# Safari's companion app remembers only pages where the reader opened Parle

The macOS, iPhone and iPad host apps show a **Recent** list. The list is not a passive browser
history and it is not a second Discussion cache. A page enters it only when the reader explicitly
opens Parle on that page.

Each row keeps the page's canonical original address, its local title, the time Parle was opened,
an archived-copy link when one was found, and every Discussion row the panel knows about. As that
same open panel receives later frames, its row is updated without changing the opened time. Frames
from one explicit open share that time. Their Archive and Discussion results merge monotonically,
using an order-independent join for duplicate metadata, so a timed-out native request or Safari
service-worker restart cannot erase results that reached the companion before a newer worker frame.
Opening the same page again starts a newer row version that replaces the older visit and may
therefore remove stale results. The projection has no fields for comments, Digest text, referrers,
tab identifiers or page contents.

The extension sends the projection to its containing Safari app through Safari native messaging.
The native handler partitions it by Safari's profile identifier and stores it in a device-local
App Group container shared by the extension and companion. The list does not use iCloud or any
project server and therefore does not sync between devices.

The bound is **100 pages or 30 days, whichever is reached first**. Both the writer and the app's
reader prune expired rows, so a device on which the extension has stopped running cannot retain a
row merely because no later write arrived. A duplicate canonical address in one Safari profile
replaces the older row; the same address in another profile remains separate.

On iOS and iPadOS the App Group is `group.com.ziahamza.parle.shared`. On macOS it is the legacy
team-prefixed `85A9MS6428.com.ziahamza.parle.shared`, which keeps the direct Developer ID build
compatible as well as the Mac App Store build. These are device-local stores, not a cross-platform
sync mechanism.

The settings page's **Forget everything** action clears this list on Safari as well as the stores
defined by [ADR 0015](./0015-what-is-stored-and-for-how-long.md). The companion app also exposes
**Clear Recents**. Settings survive both actions.

Clear also records a device-local watermark. A panel that was already open before the clear may
still receive a late Archive or Discussion frame, but that pre-clear session cannot recreate its
row. Only another explicit open after the clear can do so.

## Consequences

- Chrome behavior does not change and its manifest does not request native messaging.
- Safari alone requests `nativeMessaging`; content scripts never call it.
- A panel left open may improve its saved row as Discussions or Archive arrive, but navigation,
  background tabs and ordinary automatic lookups never create a Recent row.
- The privacy policy and settings copy must name this readable, bounded exception before an Apple
  build containing it is uploaded.
- Cross-device history would require a new storage and privacy decision; it is not implied by the
  companion app.
