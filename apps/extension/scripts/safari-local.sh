#!/usr/bin/env bash
# Build Parle for Safari on THIS Mac and walk through enabling it.
#
# Run it from anywhere:   bash apps/extension/scripts/safari-local.sh
# It is safe to re-run; every step is idempotent.
#
# What it automates: the Web Extension build, the generated Xcode project, the
# ad-hoc-signed macOS app, and launching that app once so Safari learns the
# extension exists. What it cannot automate — and stops to tell you about —
# are Safari's own switches: unsigned-extension consent is deliberately a
# human act on macOS.
set -euo pipefail

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
step() { printf '  %s\n' "$*"; }

here="$(cd "$(dirname "$0")/../../.." && pwd)"
say "Parle → Safari, from $here"

say "1/5 · Toolchain"
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Xcode command line tools are missing. Run: xcode-select --install" >&2
  exit 1
fi
if ! xcodebuild -version >/dev/null 2>&1; then
  echo "Full Xcode is required (xcodebuild). Install it from the App Store, then:" >&2
  echo "  sudo xcode-select -s /Applications/Xcode.app" >&2
  exit 1
fi
step "xcodebuild: $(xcodebuild -version | head -1)"
if ! command -v pnpm >/dev/null 2>&1; then
  step "pnpm missing — enabling via corepack"
  corepack enable >/dev/null 2>&1 || npm install -g pnpm@9.12.0
fi
step "node: $(node --version)  pnpm: $(pnpm --version)"

say "2/5 · Build the Safari Web Extension and its Xcode project"
cd "$here"
pnpm install --frozen-lockfile
pnpm package:safari

say "3/5 · Compile the macOS app (ad-hoc signed, runs locally only)"
derived="$here/apps/extension/.output/safari-derived"
xcodebuild \
  -project "$here/apps/extension/.output/safari-apple/Parle/Parle.xcodeproj" \
  -scheme 'Parle (macOS)' \
  -configuration Debug \
  -destination 'generic/platform=macOS' \
  -derivedDataPath "$derived" \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES \
  build | tail -3

app="$derived/Build/Products/Debug/Parle.app"
[ -d "$app" ] || { echo "Build finished but $app is missing" >&2; exit 1; }

say "4/5 · Register the extension with Safari"
step "Launching the containing app once — you can quit it right after."
open "$app"

say "5/5 · Your part (Safari will not let a script do this, on purpose)"
cat <<'HAND'
  a. Safari → Settings → Advanced → tick “Show features for web developers”.
  b. Develop menu → “Allow Unsigned Extensions” (asks for your password;
     resets every time Safari quits — that is Apple's rule for dev builds).
  c. Safari → Settings → Extensions → tick “Parle”.
  d. Open any article — e.g. https://en.wikipedia.org/wiki/Hacker_News —
     answer the first-run question, and the mark should appear top-right.

  QA pass worth doing while you are there:
  - the mark opens the dock; ✕ closes it; a click on the page closes it
  - pin it (under 640px wide windows the pin is hidden by design)
  - Reddit rows show YOUR Reddit session's view
  - schlarp.com/posts/everything-i-own-owned/ — the “Could not read this
    one.” report; open the discussion and see what it does on Safari
HAND
say "Done. Re-run this script after any code change; steps b–c persist per Safari session."
