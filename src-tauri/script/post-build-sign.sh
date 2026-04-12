#!/bin/bash
# Post-build: re-sign the .app with entitlements and re-package the DMG.
# Tauri doesn't embed entitlements for ad-hoc signing, so we do it manually.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAURI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTITLEMENTS="$TAURI_DIR/Entitlements.plist"
APP_PATH="$TAURI_DIR/target/release/bundle/macos/ani-mime.app"
DMG_DIR="$TAURI_DIR/target/release/bundle/dmg"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: $APP_PATH not found. Run 'bun run tauri build' first."
  exit 1
fi

if [ ! -f "$ENTITLEMENTS" ]; then
  echo "Error: $ENTITLEMENTS not found."
  exit 1
fi

echo "==> Re-signing ani-mime.app with entitlements..."
codesign --force --sign - --entitlements "$ENTITLEMENTS" "$APP_PATH"

# Verify
echo "==> Verifying entitlements..."
codesign -d --entitlements - "$APP_PATH" 2>&1 | grep -q "network.server" \
  && echo "    OK: network entitlements embedded" \
  || { echo "    FAIL: entitlements not found"; exit 1; }

# Re-create DMG
VERSION=$(grep '"version"' "$TAURI_DIR/tauri.conf.json" | head -1 | sed 's/.*: "//;s/".*//')
ARCH=$(uname -m)
DMG_NAME="ani-mime_${VERSION}_${ARCH}.dmg"
DMG_PATH="$DMG_DIR/$DMG_NAME"

echo "==> Creating DMG: $DMG_NAME"
rm -f "$DMG_PATH"
mkdir -p "$DMG_DIR"

hdiutil create -volname "ani-mime" \
  -srcfolder "$APP_PATH" \
  -ov -format UDZO \
  "$DMG_PATH"

echo ""
echo "Done! Distribution-ready files:"
echo "  .app: $APP_PATH"
echo "  .dmg: $DMG_PATH"
