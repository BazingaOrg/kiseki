#!/bin/zsh
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
if [[ ! -d "$DEVELOPER_DIR" ]]; then
  print -u2 "未找到完整 Xcode。请安装 Xcode，或用 DEVELOPER_DIR 指定其 Developer 目录。"
  exit 1
fi
xcodebuild -version
xcodebuild -checkFirstLaunchStatus
xcodebuild -showsdks
xcrun simctl list runtimes
xcrun simctl list devices available
xcrun devicectl list devices
