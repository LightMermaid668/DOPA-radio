# DOPA-radio デプロイ手順（Proxmox + Cloudflare Tunnel）

対象: 自宅 Proxmox 上の LXC コンテナ 1 台で Docker Compose を動かす構成。

## 0. 前提チェック

- [ ] Cloudflare に `sosukeiwasaki.f5.si` ゾーンが登録済み（NS 委譲済み）
- [ ] Google Cloud Console で OAuth クライアント発行済み
  - 承認済み JavaScript 生成元: `https://dopa-radio.sosukeiwasaki.f5.si`
  - 承認済みリダイレクト URI: `https://dopa-radio.sosukeiwasaki.f5.si/api/auth/callback/google`

## 1. LXC コンテナ作成（Proxmox UI）

| 項目 | 値 |
|---|---|
| テンプレート | Debian 12 または 13 standard |
| CPU | 2 vCPU |
| メモリ | 2 GB（余裕があれば 4 GB） |
| ディスク | 32 GB（音源は Garage がここに保存。後から拡張可） |
| ネットワーク | 固定 IP（例: `192.168.1.50/24`、GW はルーター） |
| 特権 | 非特権で可 |

または SSH から:

```bash
pct create 200 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname dopa-radio --cores 2 --memory 2048 \
  --rootfs local-lvm:32 --net0 name=eth0,bridge=vmbr0,ip=192.168.1.50/24,gw=192.168.1.1 \
  --unprivileged 1 --features nesting=1 --start 1
```

> `nesting=1` と、Docker 用に `/etc/pve/lxc/200.conf` へ
> `lxc.apparmor.profile: unconfined` / `lxc.cgroup2.devices.allow: a` の追記が必要になる場合があります。

## 2. Docker 導入（コンテナ内）

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

## 3. 自動デプロイ導入（推奨）

LXC 内で、公開鍵（private リポジトリの場合）または URL を指定して実行します:

```bash
cd /root
# スクリプトを取得（いずれかの方法）
#   a) GitHub から直接
curl -fsSL -o install-autodeploy.sh \
  https://raw.githubusercontent.com/LightMermaid668/DOPA-radio/main/deploy/install-autodeploy.sh
#   b) Mac から: scp deploy/install-autodeploy.sh root@192.168.1.50:/root/

chmod +x install-autodeploy.sh
./install-autodeploy.sh https://github.com/LightMermaid668/DOPA-radio.git
```

> - LXC の Debian 最小構成には `sudo` が入っていないことがあります。root でログインしている場合、`sudo` は不要です（そのまま `./install-autodeploy.sh ...`）。
> - root 以外のユーザーで実行する場合は `sudo` を付けてください。

> private リポジトリに変更した場合は SSH URL を渡してください:
> `./install-autodeploy.sh git@github.com:LightMermaid668/DOPA-radio.git`
> （Deploy Key を生成し、GitHub への登録手順を案内します）

このスクリプトが行うこと:

1. Docker / Docker Compose の確認
2. Deploy Key の生成（SSH URL の場合のみ。初回は「GitHub に公開鍵を登録して再実行」と案内されます）
3. **prod ブランチ**のクローン → `/opt/dopa-radio`
4. `.env` の雛形作成（初回のみ）
5. systemd timer 登録 → **5分間隔で prod をチェックし、更新があれば自動で再ビルド・デプロイ**

### マニュアル配置（自動デプロイを使わない場合）

```bash
rsync -av --exclude node_modules --exclude .next --exclude .git \
  ./ root@192.168.1.50:/opt/dopa-radio/
# または
git clone <repository-url> /opt/dopa-radio
```

## 4. .env 作成

```bash
cd /opt/dopa-radio
cp .env.example .env
openssl rand -hex 32   # → BETTER_AUTH_SECRET に記入
openssl rand -hex 24   # → POSTGRES_PASSWORD に記入
echo "S3_ACCESS_KEY=GK$(openssl rand -hex 16)"   # → 出力を .env へ
echo "S3_SECRET_KEY=$(openssl rand -hex 32)"     # → 出力を .env へ
nano .env
chmod 600 .env
```

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` もここで記入します（チャット等に貼らないこと）。

## 5. Cloudflare Tunnel 作成

1. Cloudflare ダッシュボード → **Zero Trust** → **Networks** → **Tunnels**
2. **Create a tunnel** → 種類 **Cloudflared** → 名前 `dopa-radio`
3. **Docker** タブに表示される `--token eyJ...` の **トークン部分だけ**を `.env` の `CLOUDFLARE_TUNNEL_TOKEN` に貼る
4. **Public Hostnames** を2つ追加:

| Subdomain | Domain | Service |
|---|---|---|
| `dopa-radio` | `sosukeiwasaki.f5.si` | `http://caddy:80` |
| `dopa-media` | `sosukeiwasaki.f5.si` | `http://caddy:80` |

> **注意**: メディア用は必ず**1階層**のサブドメイン（例: `dopa-media.sosukeiwasaki.f5.si`）にしてください。
> `media.dopa-radio.sosukeiwasaki.f5.si` のような2階層サブドメインは Cloudflare 無料の Universal SSL
> （`*.sosukeiwasaki.f5.si`）の対象外で、TLSエラー（`ERR_SSL_VERSION_OR_CIPHER_MISMATCH`）になります。

（云flare が CNAME レコードを自動作成します。`http://caddy:80` は Compose 内のサービス名で解決されます）

> **重要**: LXC 本体に cloudflared を systemd サービスとしてインストールしないでください
> （ダッシュボードの「Debian」タブの手順は使わない）。このプロジェクトは Compose 内の
> cloudflared を使うため、ホスト側にも入れると**二重接続**になり、ホスト側が docker の
> 内部名 `caddy` を解決できず 502 の原因になります。
> 入ってしまった場合: `systemctl disable --now cloudflared`

## 6. 起動

`.env` 設定後、以下のどちらか:

```bash
# 即時デプロイ
sudo systemctl start dopa-radio-deploy.service
journalctl -u dopa-radio-deploy.service -f

# または 5 分以内の自動実行を待つ
# 状態確認
systemctl list-timers dopa-radio-deploy.timer
```

初回ビルドは数分かかります。ログで「マイグレーション → Next.js 起動」を確認してください:

```bash
docker compose logs -f web
```

## 7. 動作確認チェックリスト

- [ ] `https://dopa-radio.sosukeiwasaki.f5.si/api/health` が `{"ok":true}` を返す
- [ ] トップページが表示される
- [ ] 新規登録（メール+パスワード）でログインできる
- [ ] Google ログインでログインできる
- [ ] 未ログインで `/library` にアクセスすると `/login` に飛ぶ
- [ ] iPhone Safari で「共有 → ホーム画面に追加」→ アイコンから起動できる（スタンドアロン表示）
- [ ] `docker compose ps` で全サービスが healthy / running

## 8. 運用

### ブランチとデプロイの流れ

```
main（開発）── promote ──▶ prod（本番）── 自動検知 ──▶ LXC が再ビルド・反映
```

1. 開発は `main` に push（CI が typecheck / lint / build を実行）
2. リリースしたいタイミングで **GitHub Actions → `promote-to-prod` → Run workflow**
   （`main` を `prod` にファストフォワード）
3. LXC の systemd timer が 5 分以内に `prod` の更新を検知 → 自動デプロイ

### コマンド

```bash
# ログ
docker compose logs -f web worker cloudflared
journalctl -u dopa-radio-deploy.service -f   # デプロイログ

# 手動で今すぐデプロイ
sudo systemctl start dopa-radio-deploy.service

# 再起動だけ（コード変更なし）
docker compose restart web worker

# 停止
docker compose down

# いま prod のどのコミットが動いているか
cd /opt/dopa-radio && git log --oneline -1
```

### 注意点

- **Cloudflare Free のリクエストボディ上限は 100MB/リクエスト**。音源アップロードは presigned URL で CHUNK 分割 or 100MB 以下運用（ビットレート的には十分）
- Garage（S3互換ストレージ）には Web コンソールがありません。状態確認は `docker compose exec garage /garage status`
- `garage.toml` は deploy.sh が初回に自動生成します（git 管理外・シークレット入り）
- バックアップ（PBS + オフサイト）はフェーズ5で構築。**それまで音源のバックアップは手動で**
- 停電・回線断でサービスは停止する（自宅サーバーの宿命）。Cloudflare 側は 502/1033 を返す

### トラブルシューティング

| 症状 | 確認 |
|---|---|
| 502 Bad Gateway | `docker compose ps` と `docker compose logs cloudflared`（トークン・宛先 `http://caddy:80` の設定） |
| 502 + ログに `lookup caddy ... no such host` | ホスト側 cloudflared サービスとの二重接続。`systemctl disable --now cloudflared`（Compose 内の cloudflared だけにする） |
| `Provided Tunnel token is not valid` | `.env` の `CLOUDFLARE_TUNNEL_TOKEN` に、ダッシュボードの **`--token` の後ろの文字列のみ**（`eyJ`で始まる）を設定。`--token` や引用符・空白を含めない |
| アップロード時に `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` | メディア用ホストが2階層サブドメイン（Universal SSL対象外）。1階層（`dopa-media.sosukeiwasaki.f5.si`）に変更し、TunnelのPublic Hostnameと `.env` の `MEDIA_DOMAIN` / `S3_PUBLIC_ENDPOINT` を合わせる |
| アップロードのプリフライト(OPTIONS)が404 / CORSエラー | ①`.env` の `MEDIA_DOMAIN` が `dopa-media.sosukeiwasaki.f5.si` か確認 ②TunnelのPublic HostnameのServiceが `http://caddy:80` か確認 ③最新をデプロイ（Caddyfileは `deploy/caddy/` をディレクトリマウント。デプロイ時に自動でcaddy再作成） |
| ログインで `redirect_uri_mismatch` | Google Console のリダイレクト URI を確認 |
| 登録できない | `docker compose logs postgres web`（マイグレーション成功しているか） |
| 1033 Tunnel error | `cloudflared` トークン・トンネル起動状態を確認 |
| 署名エラー（将来のS3） | `MEDIA_DOMAIN` と presign エンドポイントの一致を確認 |
