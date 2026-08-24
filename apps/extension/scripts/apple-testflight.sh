#!/usr/bin/env bash
# Build, sign, and upload the Safari/iOS apps to TestFlight — the macOS half
# of the Apple release. Everything before it (the WebExtension build, the
# package audit) and after it (TestFlight distribution) is Linux work; this
# script is the irreducible macOS core, kept to one runner-job:
#
#   generate the Xcode project from .output/safari-package
#   → archive macOS + iOS (unsigned)
#   → export both with manual App Store signing
#   → upload both to App Store Connect
#
# Inputs, all via environment (in CI: GitHub secrets; locally: your shell):
#   APPSTORE_CERT_BASE64             Apple Distribution .p12, base64
#   APPSTORE_CERT_PASSWORD           its password
#   APPSTORE_INSTALLER_CERT_BASE64   Mac Installer Distribution .p12, base64 (same password)
#   APPSTORE_PROFILE_MAC_APP / _MAC_EXT / _IOS_APP / _IOS_EXT
#                                    App Store provisioning profiles, base64
#   APPLE_ASC_KEY_ID / APPLE_ASC_ISSUER_ID / APPLE_ASC_PRIVATE_KEY
#                                    App Store Connect API key (upload auth)
#   BUILD_NUMBER                     CFBundleVersion; must increase per upload
#                                    (CI passes github.run_number)
#   SKIP_UPLOAD=validate             validate with App Store Connect but do
#                                    not create a build (local dry runs)
set -euo pipefail

TEAM_ID="85A9MS6428"
APP_ID="com.ziahamza.parle"
EXT_ID="com.ziahamza.parle.Extension"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSION_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PREPARED="$EXTENSION_ROOT/.output/safari-package"
OUT="$EXTENSION_ROOT/.output/testflight"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$PREPARED/manifest.json','utf8')).version")"
BUILD_NUMBER="${BUILD_NUMBER:?set BUILD_NUMBER (CI: github.run_number)}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
[ -f "$PREPARED/manifest.json" ] || { echo "No prepared package at $PREPARED — run pnpm build:safari first" >&2; exit 1; }
rm -rf "$OUT"; mkdir -p "$OUT"

say "1/6 · Keychain (temporary, deleted on exit)"
KEYCHAIN="$OUT/testflight.keychain-db"
KEYCHAIN_PASS="$(openssl rand -hex 16)"
security create-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN"
security set-keychain-settings -lut 3600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN"
ORIGINAL_KEYCHAINS="$(security list-keychains -d user | tr -d '"' | tr '\n' ' ')"
cleanup() {
  # shellcheck disable=SC2086
  security list-keychains -d user -s $ORIGINAL_KEYCHAINS 2>/dev/null || true
  security delete-keychain "$KEYCHAIN" 2>/dev/null || true
}
trap cleanup EXIT
printf '%s' "$APPSTORE_CERT_BASE64" | base64 -d > "$OUT/dist.p12"
printf '%s' "$APPSTORE_INSTALLER_CERT_BASE64" | base64 -d > "$OUT/installer.p12"
security import "$OUT/dist.p12" -k "$KEYCHAIN" -P "$APPSTORE_CERT_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild
security import "$OUT/installer.p12" -k "$KEYCHAIN" -P "$APPSTORE_CERT_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild
security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASS" "$KEYCHAIN" >/dev/null
# shellcheck disable=SC2086
security list-keychains -d user -s "$KEYCHAIN" $ORIGINAL_KEYCHAINS
rm -f "$OUT/dist.p12" "$OUT/installer.p12"

say "2/6 · Provisioning profiles"
PROFILES="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$PROFILES"
for pair in "APPSTORE_PROFILE_MAC_APP:mac-app" "APPSTORE_PROFILE_MAC_EXT:mac-ext" "APPSTORE_PROFILE_IOS_APP:ios-app" "APPSTORE_PROFILE_IOS_EXT:ios-ext"; do
  var="${pair%%:*}"; name="${pair##*:}"
  printf '%s' "${!var}" | base64 -d > "$OUT/$name.provisionprofile"
  uuid="$(security cms -D -i "$OUT/$name.provisionprofile" | plutil -extract UUID raw -o - -)"
  cp "$OUT/$name.provisionprofile" "$PROFILES/$uuid.provisionprofile"
  # Old-style location, which some Xcode versions still read for iOS.
  mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
  cp "$OUT/$name.provisionprofile" "$HOME/Library/MobileDevice/Provisioning Profiles/$uuid.mobileprovision"
done

say "3/6 · Generate the Xcode project ($VERSION build $BUILD_NUMBER)"
bash "$SCRIPT_DIR/package-safari.sh"
PROJECT="$EXTENSION_ROOT/.output/safari-apple/Parle/Parle.xcodeproj"
# Xcode 16's converter derives the identifier's case from the app name —
# "com.ziahamza.Parle" — while Xcode 27's respects --bundle-identifier.
# Bundle ids are case-sensitive in App Store Connect, so normalize the
# generated project to the registered ids (a no-op on converters that
# already got it right; measured on the hosted runner, 2026-08-24).
sed -i '' \
  -e "s/com\.ziahamza\.Parle\.Extension/$EXT_ID/g" \
  -e "s/com\.ziahamza\.Parle/$APP_ID/g" \
  "$PROJECT/project.pbxproj"
# The converter stamps 1.0/1; the truth is the manifest and the run number.
find "$EXTENSION_ROOT/.output/safari-apple/Parle" -name "Info.plist" | while read -r plist; do
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$plist" 2>/dev/null || true
done

say "4/6 · Archive (unsigned; signing happens at export)"
for platform in macOS iOS; do
  dest="generic/platform=$platform"
  xcodebuild \
    -project "$PROJECT" \
    -scheme "Parle ($platform)" \
    -configuration Release \
    -destination "$dest" \
    -archivePath "$OUT/Parle-$platform.xcarchive" \
    CODE_SIGNING_ALLOWED=NO \
    MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
    archive | tail -2
done

say "5/6 · Export with manual App Store signing"
cat > "$OUT/export-mac.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>installerSigningCertificate</key><string>3rd Party Mac Developer Installer</string>
  <key>provisioningProfiles</key><dict>
    <key>$APP_ID</key><string>Parle Mac App Store</string>
    <key>$EXT_ID</key><string>Parle Extension Mac App Store</string>
  </dict>
</dict></plist>
PLIST
cat > "$OUT/export-ios.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict>
    <key>$APP_ID</key><string>Parle iOS App Store</string>
    <key>$EXT_ID</key><string>Parle Extension iOS App Store</string>
  </dict>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$OUT/Parle-macOS.xcarchive" \
  -exportOptionsPlist "$OUT/export-mac.plist" -exportPath "$OUT/mac" | tail -2
xcodebuild -exportArchive -archivePath "$OUT/Parle-iOS.xcarchive" \
  -exportOptionsPlist "$OUT/export-ios.plist" -exportPath "$OUT/ios" | tail -2
ls "$OUT/mac" "$OUT/ios"

if [ "${SKIP_UPLOAD:-}" = "validate" ]; then
  say "6/6 · Validate with App Store Connect (no build published)"
  ACTION="--validate-app"
else
  say "6/6 · Upload to App Store Connect"
  ACTION="--upload-app"
fi
# altool only searches its own well-known locations for the API key.
KEYDIR="$HOME/.appstoreconnect/private_keys"
KEYFILE="$KEYDIR/AuthKey_${APPLE_ASC_KEY_ID}.p8"
KEYFILE_WAS_OURS=0
if [ ! -f "$KEYFILE" ]; then
  mkdir -p "$KEYDIR"
  printf '%s' "$APPLE_ASC_PRIVATE_KEY" > "$KEYFILE"
  KEYFILE_WAS_OURS=1
fi
PKG="$(ls "$OUT/mac"/*.pkg)"
IPA="$(ls "$OUT/ios"/*.ipa)"
for target in "macos:$PKG" "ios:$IPA"; do
  kind="${target%%:*}"; file="${target#*:}"
  xcrun altool "$ACTION" -f "$file" -t "$kind" \
    --apiKey "$APPLE_ASC_KEY_ID" --apiIssuer "$APPLE_ASC_ISSUER_ID" \
    --output-format normal
done
[ "$KEYFILE_WAS_OURS" = "1" ] && rm -f "$KEYFILE"
say "Done: Parle $VERSION ($BUILD_NUMBER) → App Store Connect"
