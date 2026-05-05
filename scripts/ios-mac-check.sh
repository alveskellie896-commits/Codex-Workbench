#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_PATH="$ROOT_DIR/ios/CodexWorkbench/CodexWorkbench.xcodeproj"
SCHEME="CodexWorkbench"

echo "Checking Xcode..."
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild was not found. Install Xcode from the Mac App Store first."
  exit 1
fi

echo "Xcode:"
xcodebuild -version

if [ ! -d "$PROJECT_PATH" ]; then
  echo "Cannot find project: $PROJECT_PATH"
  exit 1
fi

echo ""
echo "Available schemes:"
xcodebuild -list -project "$PROJECT_PATH"

echo ""
echo "Running a source-level simulator build check..."
set +e
xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
BUILD_STATUS=$?
set -e

if [ "$BUILD_STATUS" -ne 0 ]; then
  echo ""
  echo "The simulator build check failed. Open the project in Xcode and fix the red build errors first."
  echo "Project: $PROJECT_PATH"
  open "$PROJECT_PATH"
  exit "$BUILD_STATUS"
fi

echo ""
echo "Build check passed."
echo "Opening Xcode. Connect your iPhone, select it as the run destination, set Signing Team, then press Run."
open "$PROJECT_PATH"
