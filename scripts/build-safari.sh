#!/usr/bin/env bash
# One-shot Safari build: bundle -> convert to an Xcode project -> build + sign
# -> install to /Applications.
#
#   MILHEIRO_SIGN=auto   (default) proper signing with MILHEIRO_TEAM; survives
#                        Safari restarts. Needs your Apple ID in Xcode Accounts.
#   MILHEIRO_SIGN=adhoc  ad-hoc local signing; always builds, no account needed,
#                        but Safari needs Develop > Allow Unsigned Extensions.
#   MILHEIRO_TEAM        Apple Developer team ID (default: personal dev team)
#   MILHEIRO_NO_INSTALL=1   build only, skip copy to /Applications
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="Milheiro"
# Must match the app bundle id the converter derives (com.<org>.<AppName>, app
# name capitalized) so the extension id (<BUNDLE_ID>.Extension) is prefixed by
# it. Mismatched casing => "Embedded binary's bundle identifier is not prefixed".
BUNDLE_ID="com.mracos.Milheiro"
TEAM="${MILHEIRO_TEAM:-693Z55YX47}"
PROJ_DIR="$ROOT/build/safari"
DERIVED="$PROJ_DIR/DerivedData"

echo "==> bundling dist/"
npm run build

echo "==> converting to Xcode project ($PROJ_DIR)"
rm -rf "$PROJ_DIR"
mkdir -p "$PROJ_DIR"
xcrun safari-web-extension-converter "$ROOT/dist" \
  --project-location "$PROJ_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only --swift --copy-resources --no-open --no-prompt --force

XCPROJ="$(/usr/bin/find "$PROJ_DIR" -name '*.xcodeproj' -maxdepth 3 | head -1)"
if [[ -z "$XCPROJ" ]]; then
  echo "error: no .xcodeproj generated under $PROJ_DIR" >&2
  exit 1
fi

# The converter names the scheme after the app; detect it instead of assuming.
SCHEME="$(xcodebuild -list -project "$XCPROJ" -json 2>/dev/null \
  | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["project"]["schemes"][0])')"

SIGN="${MILHEIRO_SIGN:-auto}"
if [[ "$SIGN" == "adhoc" ]]; then
  # Ad-hoc local signing: always builds, no Apple account needed. Safari treats
  # it as unsigned, so enable Develop > Allow Unsigned Extensions once per launch.
  echo "==> building (ad-hoc local signing, scheme $SCHEME)"
  xcodebuild -project "$XCPROJ" \
    -scheme "$SCHEME" \
    -configuration Release \
    -derivedDataPath "$DERIVED" \
    CODE_SIGN_STYLE=Manual \
    CODE_SIGN_IDENTITY="-" \
    DEVELOPMENT_TEAM="" \
    PROVISIONING_PROFILE_SPECIFIER="" \
    build
else
  # Proper signing: needs your Apple ID in Xcode > Settings > Accounts.
  # -allowProvisioningUpdates lets xcodebuild create/download the profile.
  echo "==> building + signing (team $TEAM, scheme $SCHEME)"
  xcodebuild -project "$XCPROJ" \
    -scheme "$SCHEME" \
    -configuration Release \
    -derivedDataPath "$DERIVED" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM" \
    CODE_SIGN_STYLE=Automatic \
    build
fi

APP="$(/usr/bin/find "$DERIVED/Build/Products/Release" -maxdepth 1 -name "$APP_NAME.app" | head -1)"
echo "==> built + signed: $APP"

LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

if [[ "${MILHEIRO_NO_INSTALL:-}" != "1" ]]; then
  echo "==> installing to /Applications and launching (registers the extension)"
  rm -rf "/Applications/$APP_NAME.app"
  cp -R "$APP" /Applications/
  # xcodebuild already registered the DerivedData copy with LaunchServices, so
  # Safari would list the extension twice. Drop that transient registration and
  # keep only the /Applications one.
  "$LSREGISTER" -u "$APP" 2>/dev/null || true
  open "/Applications/$APP_NAME.app"
  echo
  echo "Now enable it: Safari > Settings > Extensions > $APP_NAME"
  if [[ "$SIGN" == "adhoc" ]]; then
    echo "Ad-hoc build: also Safari > Develop > Allow Unsigned Extensions"
  fi
fi
