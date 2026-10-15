#!/usr/bin/env bash
# LXC に一度だけ実行する自動デプロイ導入スクリプト
#
# usage:
#   sudo ./install-autodeploy.sh git@github.com:LightMermaid668/DOPA-radio.git
#   sudo ./install-autodeploy.sh https://github.com/LightMermaid668/DOPA-radio.git   # 公開リポジトリの場合
#
# 実施内容:
#   1. Docker / Docker Compose の確認
#   2. (SSH URL の場合) Deploy Key の生成と案内
#   3. prod ブランチのクローン（/opt/dopa-radio）
#   4. .env の雛形作成（初回のみ）
#   5. systemd timer の登録（5分間隔で prod をチェック → 更新があれば自動デプロイ）
set -euo pipefail
export GIT_TERMINAL_PROMPT=0

REPO_URL="${1:-}"
APP_DIR="${APP_DIR:-/opt/dopa-radio}"
BRANCH="${BRANCH:-prod}"

if [ -z "$REPO_URL" ]; then
  echo "usage: $0 <git-repo-url>" >&2
  echo "  例: $0 git@github.com:LightMermaid668/DOPA-radio.git" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "エラー: docker が見つかりません。先に Docker を導入してください（docs/deploy.md 手順2）" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "エラー: docker compose (v2) が必要です" >&2
  exit 1
fi

# private リポジトリを SSH で取得する場合の Deploy Key 準備
if [[ "$REPO_URL" == git@* ]]; then
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  KEY=/root/.ssh/dopa_deploy
  if [ ! -f "$KEY" ]; then
    ssh-keygen -t ed25519 -N "" -C "dopa-radio-deploy" -f "$KEY" >/dev/null
    echo "[ssh] Deploy Key を生成しました: $KEY"
  fi
  if ! grep -q "Host github.com" /root/.ssh/config 2>/dev/null; then
    cat >>/root/.ssh/config <<EOF
Host github.com
  HostName github.com
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
EOF
    chmod 600 /root/.ssh/config
  fi
  touch /root/.ssh/known_hosts
  ssh-keyscan -t ed25519,rsa github.com >>/root/.ssh/known_hosts 2>/dev/null || true

  if ! git ls-remote "$REPO_URL" >/dev/null 2>&1; then
    echo ""
    echo "==============================================================="
    echo " GitHub への接続に失敗しました。以下の公開鍵を"
    echo " GitHub リポジトリ → Settings → Deploy keys → Add deploy key"
    echo "（read-only でOK）に登録してから、このスクリプトを再実行してください。"
    echo ""
    echo "----- 公開鍵ここから -----"
    cat "$KEY.pub"
    echo "----- 公開鍵ここまで -----"
    echo "==============================================================="
    exit 1
  fi
fi

# クローン（初回のみ）
if [ ! -d "$APP_DIR/.git" ]; then
  mkdir -p "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  echo "[git] 既存のリポジトリを使用: $APP_DIR"
fi

cd "$APP_DIR"
chmod +x deploy/deploy.sh

# .env の雛形（初回のみ。git 管理外なので更新で上書きされない）
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo ""
  echo "==============================================================="
  echo " .env を作成しました。値を編集してください:"
  echo "   nano $APP_DIR/.env"
  echo ""
  echo " 設定後、以下のどちらかで初回デプロイ:"
  echo "   sudo systemctl start dopa-radio-deploy.service   # 即時"
  echo "   何もしない                                       # 5分以内に自動実行"
  echo "==============================================================="
fi

# systemd ユニット導入
cp deploy/dopa-radio-deploy.service /etc/systemd/system/dopa-radio-deploy.service
cp deploy/dopa-radio-deploy.timer /etc/systemd/system/dopa-radio-deploy.timer
sed -i "s|/opt/dopa-radio|$APP_DIR|g" /etc/systemd/system/dopa-radio-deploy.service
systemctl daemon-reload
systemctl enable --now dopa-radio-deploy.timer

echo ""
echo "[完了] 自動デプロイを有効化しました（5分間隔で prod ブランチをチェック）"
echo "  - 状態確認: systemctl list-timers dopa-radio-deploy.timer"
echo "  - ログ:     journalctl -u dopa-radio-deploy.service -f"
