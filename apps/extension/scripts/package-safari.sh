#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSION_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PREPARED="$EXTENSION_ROOT/.output/safari-package"
PROJECT_LOCATION="$EXTENSION_ROOT/.output/safari-apple"

if xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
  PACKAGER="safari-web-extension-packager"
elif xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  PACKAGER="safari-web-extension-converter"
else
  echo "Xcode does not provide the Safari Web Extension packager." >&2
  exit 1
fi

xcrun "$PACKAGER" \
  --project-location "$PROJECT_LOCATION" \
  --app-name Parle \
  --bundle-identifier com.ziahamza.parle \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force \
  "$PREPARED"

cp "$EXTENSION_ROOT/../../store/apple/app-icon-1024.png" \
  "$PROJECT_LOCATION/Parle/Shared (App)/Assets.xcassets/AppIcon.appiconset/universal-icon-1024@1x.png"

node "$SCRIPT_DIR/customize-safari-host.ts" "$PROJECT_LOCATION/Parle"
node "$EXTENSION_ROOT/../../store/check-safari-host.ts" "$PROJECT_LOCATION/Parle"

echo "Generated Apple host project: $PROJECT_LOCATION/Parle/Parle.xcodeproj"
