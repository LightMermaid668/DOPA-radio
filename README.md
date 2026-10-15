# DOPA-radio

ドパガキのための音楽配信サービス（PWA）。

- 曲をアップロードして公開・共有（権利確認つき）
- 自前音源＋Apple Music / Spotify の曲を混在できるプレイリスト
- iOS/Android のバックグラウンドで流れ続けるプレイヤー（HLS）
- プレイリストの共有（公開 / 限定公開 / 非公開）
- 自宅 Proxmox + Cloudflare Tunnel で運用（$0 ランニング）

詳細な計画は実装フェーズごとの README / docs を参照。

## スタック

| 層 | 技術 |
|---|---|
| Web/API | Next.js 15 (App Router) + TypeScript + Tailwind CSS 4 |
| PWA | manifest + Service Worker + Media Session API |
| DB | PostgreSQL 16 + Drizzle ORM |
| 認証 | Better Auth（メール+パスワード / Google OAuth） |
| ストレージ | Garage（S3 互換） |
| ジョブ | pg-boss + ffmpeg（worker） |
| 配信 | Docker Compose + Caddy + Cloudflare Tunnel |

## 開発（ローカル）

```bash
npm install
npm run icons          # public/icons/*.png を生成
cp .env.example .env   # ローカル用に値を調整（DATABASE_URL 等）
npm run db:generate    # スキーマ変更時にマイグレーション生成
npm run dev            # http://localhost:3000
```

DB とストレージは Docker で立てる場合:

```bash
docker compose up -d postgres garage
```

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` / `npm start` | 本番ビルド / 起動 |
| `npm run lint` / `npm run typecheck` | Lint / 型チェック |
| `npm run db:generate` | Drizzle マイグレーション生成 |
| `npm run db:migrate` | マイグレーション適用 |
| `npm run worker` | ワーカー起動（pg-boss） |
| `npm run icons` | PWA アイコン生成 |

## デプロイ

[`docs/deploy.md`](docs/deploy.md) を参照（Proxmox LXC + Cloudflare Tunnel + 自動デプロイ）。

### ブランチ運用

| ブランチ | 役割 |
|---|---|
| `main` | 開発。push すると CI（typecheck / lint / build）が走る |
| `prod` | 本番。LXC が5分間隔で監視し、更新を検知すると自動で再ビルド・デプロイ |

リリース手順: GitHub Actions の **promote-to-prod** を手動実行（`main` → `prod` にファストフォワード）。

## ロードマップ

- [x] フェーズ0: 基盤（認証・PWA・インフラ）
- [x] フェーズ1: アップロード + ffmpeg → AAC/HLS 変換 + 倍速プレイヤー
- [x] フェーズ2: プレイリスト + 共有（OG画像・公開ページ）
- [ ] フェーズ3: Apple Music / Spotify 連携（ハンドオフ）
- [ ] フェーズ4: ドパモード（無限自動再生）+ 通報 / 管理
- [ ] フェーズ5: バックアップ / 監視 / クォータ
- [ ] 将来: ネイティブアプリ（MusicKit native で混在自動キュー）
