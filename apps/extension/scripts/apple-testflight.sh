#!/usr/bin/env bash
# Build, sign, and upload the Safari/iOS apps to TestFlight — the macOS half
# of the Apple release. Everything before it (the WebExtension build, the
# package audit) and after it (TestFlight distribution) is Linux work; this
# script is the irreducible macOS core, kept to one runner-job:
#
#   generate the Xcode project from .output/safari-package
#   → archive macOS ad-hoc and iOS with its App Store profiles
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
#   APPLE_MARKETING_VERSION          iOS/macOS App Store version; defaults to
#                                    the existing first-version record, 1.0
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
REPO_ROOT="$(cd "$EXTENSION_ROOT/../.." && pwd)"
PREPARED="$EXTENSION_ROOT/.output/safari-package"
OUT="$EXTENSION_ROOT/.output/testflight"
VERSION="${APPLE_MARKETING_VERSION:-1.0}"
BUILD_NUMBER="${BUILD_NUMBER:?set BUILD_NUMBER (CI: github.run_number)}"

[[ "$VERSION" =~ ^[0-9]+([.][0-9]+){0,2}$ ]] || {
  echo "APPLE_MARKETING_VERSION must be a numeric App Store version (for example 1.0)" >&2
  exit 1
}

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
# The converter stamps 1.0/1; the truth is the App Store version contract and
# the run number. The WebExtension manifest has its own independent version.
# App Store validation (measured under Xcode 26's toolchain) also demands an
# app category on the app bundles — the converter writes none.
find "$EXTENSION_ROOT/.output/safari-apple/Parle" -name "Info.plist" | while read -r plist; do
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$plist" 2>/dev/null || true
  case "$plist" in
    *"(App)"*)
      /usr/libexec/PlistBuddy -c "Add :LSApplicationCategoryType string public.app-category.news" "$plist" 2>/dev/null ||
        /usr/libexec/PlistBuddy -c "Set :LSApplicationCategoryType public.app-category.news" "$plist"
      ;;
  esac
done

say "4/6 · Archive (preserve each platform's signed entitlements)"
# Two platforms, two archive-time signing modes, both measured:
#   macOS — ad-hoc. Entitlements embed at signing time, and an export that
#   re-signs an unsigned archive ships bundles with none; App Store Connect
#   then refuses the package for the missing app-sandbox entitlement (90296).
#   iOS — App Store signed. Xcode 26 refuses ad-hoc iOS signing, while exporting
#   an unsigned archive omits the App Group from the final signature even when
#   the selected distribution profile authorizes it. The generated Release
#   configurations select the distinct app and extension profiles by name.
MAC_SIGNING=(CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES DEVELOPMENT_TEAM="" PROVISIONING_PROFILE_SPECIFIER="")
IOS_SIGNING=(CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES)
for platform in macOS iOS; do
  dest="generic/platform=$platform"
  if [ "$platform" = "macOS" ]; then signing=("${MAC_SIGNING[@]}"); else signing=("${IOS_SIGNING[@]}"); fi
  xcodebuild \
    -project "$PROJECT" \
    -scheme "Parle ($platform)" \
    -configuration Release \
    -destination "$dest" \
    -archivePath "$OUT/Parle-$platform.xcarchive" \
    "${signing[@]}" \
    MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
    archive | tail -2
done

# Project membership is not enough for a privacy manifest: audit the archived
# app and embedded extension that will actually be exported. This also holds
# the registered identifier casing and export-compliance declaration at the
# last reversible gate before App Store signing and upload.
node "$REPO_ROOT/store/check-safari-host.ts" \
  "$EXTENSION_ROOT/.output/safari-apple/Parle" \
  --built-product "$OUT/Parle-macOS.xcarchive/Products/Applications/Parle.app" \
  --built-product "$OUT/Parle-iOS.xcarchive/Products/Applications/Parle.app"

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

# Export is a second signing operation, so the archive audit above cannot prove
# what altool will receive. Extract the actual IPA and installer package and
# hold their nested code signatures, distribution profiles, identifiers, App
# Groups, complete Web Extension resources, and privacy manifests before either
# validation or upload.
MAC_PACKAGES=("$OUT/mac"/*.pkg)
IOS_PACKAGES=("$OUT/ios"/*.ipa)
[ "${#MAC_PACKAGES[@]}" -eq 1 ] && [ -f "${MAC_PACKAGES[0]}" ] || {
  echo "Expected exactly one exported macOS .pkg" >&2
  exit 1
}
[ "${#IOS_PACKAGES[@]}" -eq 1 ] && [ -f "${IOS_PACKAGES[0]}" ] || {
  echo "Expected exactly one exported iOS .ipa" >&2
  exit 1
}
PKG="${MAC_PACKAGES[0]}"
IPA="${IOS_PACKAGES[0]}"
node "$REPO_ROOT/store/check-safari-host.ts" \
  "$EXTENSION_ROOT/.output/safari-apple/Parle" \
  --expected-version "$VERSION" \
  --expected-build "$BUILD_NUMBER" \
  --exported-pkg "$PKG" \
  --exported-ipa "$IPA"

if [ "${SKIP_UPLOAD:-}" = "validate" ]; then
  say "6/6 · Validate with App Store Connect (no build published)"
  ACTION="--validate-app"
else
  say "6/6 · Audit the live policy, then upload to App Store Connect"
  # Keep the delivery primitive safe when this script is invoked directly,
  # not only when the workflow's earlier gate ran. Validation creates no build
  # and deliberately remains available while the live policy is being staged.
  node "$REPO_ROOT/store/check-listing.ts" \
    --allow-package-summary-transition \
    --allow-pending-store-listing-review
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
for target in "macos:$PKG" "ios:$IPA"; do
  kind="${target%%:*}"; file="${target#*:}"
  xcrun altool "$ACTION" -f "$file" -t "$kind" \
    --apiKey "$APPLE_ASC_KEY_ID" --apiIssuer "$APPLE_ASC_ISSUER_ID" \
    --output-format normal
done
[ "$KEYFILE_WAS_OURS" = "1" ] && rm -f "$KEYFILE"
say "Done: Parle $VERSION ($BUILD_NUMBER) → App Store Connect"
