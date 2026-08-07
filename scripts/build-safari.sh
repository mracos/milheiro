#!/usr/bin/env bash
# One-shot Safari build: bundle -> convert to an Xcode project -> build + sign
# -> install to /Applications. Signs with a real Apple Development cert so the
# extension survives Safari restarts (no "allow unsigned" dance).
#
#   MILHEIRO_TEAM   Apple Developer team ID (default: personal dev team)
#   MILHEIRO_NO_INSTALL=1   build + sign only, skip copy to /Applications
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="Milheiro"
BUNDLE_ID="com.mracos.milheiro"
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

echo "==> building + signing (team $TEAM, scheme $SCHEME)"
xcodebuild -project "$XCPROJ" \
  -scheme "$SCHEME" \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_STYLE=Automatic \
  build

APP="$(/usr/bin/find "$DERIVED/Build/Products/Release" -maxdepth 1 -name "$APP_NAME.app" | head -1)"
echo "==> built + signed: $APP"

if [[ "${MILHEIRO_NO_INSTALL:-}" != "1" ]]; then
  echo "==> installing to /Applications and launching (registers the extension)"
  rm -rf "/Applications/$APP_NAME.app"
  cp -R "$APP" /Applications/
  open "/Applications/$APP_NAME.app"
  echo
  echo "Now enable it: Safari > Settings > Extensions > $APP_NAME"
fi
