#!/usr/bin/env bash
# 無料署名で実機インストール / 再署名をワンコマンドで行う。
# Xcode GUI の「dyld_shared_cache_extract_dylibs failed」問題を回避するため
# xcodebuild + devicectl で直接ビルド・インストールする。
#
# 使い方:
#   ./deploy.sh            通常インストールして起動
#   ./deploy.sh --console  ログを見ながら起動（Ctrl+Cで終了）
#   DEVICE_ID=<UDID> ./deploy.sh  デバイスを明示指定
set -euo pipefail
cd "$(dirname "$0")"

BUNDLE_ID="si.f5.sosukeiwasaki.doparadio"
DEVICE_ID="${DEVICE_ID:-}"

if [ -z "$DEVICE_ID" ]; then
  DEVICE_ID="$(xcrun devicectl list devices 2>/dev/null | awk '/connected/ && /physical/' | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1)"
fi
if [ -z "$DEVICE_ID" ]; then
  echo "[deploy] 接続中の実機が見つかりません。iPhoneをUSB接続してから再実行してください。" >&2
  echo "[deploy] （UDIDを指定する場合: DEVICE_ID=00000000-0000000000000000 ./deploy.sh）" >&2
  exit 1
fi
echo "[deploy] device: $DEVICE_ID"

if command -v xcodegen >/dev/null 2>&1; then
  xcodegen generate >/dev/null
fi

echo "[deploy] ビルド中…"
xcodebuild -project DopaRadio.xcodeproj -scheme DopaRadio -configuration Debug \
  -destination "id=$DEVICE_ID" -derivedDataPath build -allowProvisioningUpdates build \
  2>&1 | tail -2

APP="build/Build/Products/Debug-iphoneos/DopaRadio.app"
echo "[deploy] インストール中…"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP" | tail -4

if [ "${1:-}" = "--console" ]; then
  echo "[deploy] ログ付きで起動します（Ctrl+C で終了）"
  exec xcrun devicectl device process launch --console --terminate-existing \
    --device "$DEVICE_ID" "$BUNDLE_ID"
else
  xcrun devicectl device process launch --terminate-existing \
    --device "$DEVICE_ID" "$BUNDLE_ID" >/dev/null
  echo "[deploy] 完了: iPhoneで起動しました"
fi
