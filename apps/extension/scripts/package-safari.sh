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

echo "Generated Apple host project: $PROJECT_LOCATION/Parle/Parle.xcodeproj"
