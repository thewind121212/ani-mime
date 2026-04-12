#!/bin/bash
# Ani-Mime installer — removes quarantine and copies to /Applications
set -e

APP_NAME="ani-mime.app"
DEST="/Applications/$APP_NAME"

# Find the .app relative to this script (inside the DMG)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$SCRIPT_DIR/$APP_NAME"

if [ ! -d "$SOURCE" ]; then
  # Fallback: look in the DMG mount root
  SOURCE="/Volumes/ani-mime/$APP_NAME"
fi

if [ ! -d "$SOURCE" ]; then
  echo "Error: Cannot find $APP_NAME"
  exit 1
fi

echo "Installing Ani-Mime..."

# Remove quarantine attribute (prevents 'damaged' error)
xattr -cr "$SOURCE" 2>/dev/null || true

# Copy to /Applications (overwrite if exists)
if [ -d "$DEST" ]; then
  echo "Removing previous version..."
  rm -rf "$DEST"
fi

cp -R "$SOURCE" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true

echo "Installed to $DEST"
echo "You can now open Ani-Mime from your Applications folder."
open "$DEST"
