#!/usr/bin/env bash
# DOPA-radio pull型デプロイスクリプト
# prod ブランチの更新を検知して自動デプロイする（systemd timer から定期実行される想定）
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dopa-radio}"
BRANCH="${BRANCH:-prod}"

cd "$APP_DIR"

# ファイルシステムの書き込み可否チェック（ディスクI/Oエラーの早期検知）
if ! touch .deploy.write-test 2>/dev/null; then
  echo "[deploy] エラー: ファイルシステムが読み取り専用です（ディスクI/Oエラーの可能性）" >&2
  echo "[deploy] Proxmoxホストで dmesg / smartctl を確認し、LXCを停止→fsck→再起動してください" >&2
  exit 1
fi
rm -f .deploy.write-test

# 排他制御（多重起動防止）
exec 9>".deploy.lock"
if ! flock -n 9; then
  echo "[deploy] 別のデプロイが実行中のためスキップします"
  exit 0
fi

if [ ! -f .env ]; then
  echo "[deploy] エラー: .env がありません。.env.example をコピーして設定してください" >&2
  exit 1
fi

git fetch --quiet origin "$BRANCH"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

# コンテナが1つも存在しない場合（初回起動・全削除後）は、
# コードが最新でもデプロイを実行する
CONTAINERS="$(docker compose ps -aq | wc -l | tr -d ' ')"

if [ "$LOCAL" = "$REMOTE" ] && [ "$CONTAINERS" != "0" ]; then
  echo "[deploy] 最新です（$LOCAL）"
  exit 0
fi

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "[deploy] 更新を検知: $LOCAL -> $REMOTE"
  git checkout -B "$BRANCH" "origin/$BRANCH"
  git reset --hard "origin/$BRANCH"
  git clean -fd
else
  echo "[deploy] コードは最新ですがコンテナが未起動のためデプロイします"
fi

# garage.toml の初回生成（シークレットは自動生成）
if [ ! -f garage.toml ]; then
  echo "[deploy] garage.toml を生成します"
  sed -e "s|__RPC_SECRET__|$(openssl rand -hex 32)|" \
      -e "s|__ADMIN_TOKEN__|$(openssl rand -hex 32)|" \
      garage.toml.example >garage.toml
  chmod 600 garage.toml
fi

# 破損ファイルの復旧（読み取り専用中に中断されたデプロイの痕跡）
for file in package.json package-lock.json; do
  if [ ! -s "$file" ]; then
    echo "[deploy] $file が破損しています。gitから復元します"
    git checkout -- "$file"
  fi
done

echo "[deploy] docker compose を再ビルドして起動します..."
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null 2>&1 || true

# Caddyfile が変わっていたら caddy を再作成（bind mount の取りこぼし防止）
if command -v sha256sum >/dev/null 2>&1; then
  CADDY_SHA="$(sha256sum deploy/caddy/Caddyfile | cut -d' ' -f1)"
  if [ ! -f .caddyfile.sha ] || [ "$(cat .caddyfile.sha 2>/dev/null)" != "$CADDY_SHA" ]; then
    echo "[deploy] Caddyfile の変更を検知。caddy を再作成します"
    docker compose up -d --force-recreate caddy
    printf '%s' "$CADDY_SHA" >.caddyfile.sha
  fi
fi

echo "[deploy] 完了: $(git rev-parse HEAD)"
