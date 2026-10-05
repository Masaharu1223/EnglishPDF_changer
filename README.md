# PDF Exchange English

![Next.js](https://img.shields.io/badge/next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/-ReactJs-61DAFB?logo=react&logoColor=white&style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Claude](https://img.shields.io/badge/Claude%20API-D97757?style=for-the-badge&logo=anthropic&logoColor=white)
![Neon](https://img.shields.io/badge/Neon-00E599?style=for-the-badge&logo=postgresql&logoColor=white)
![Better Auth](https://img.shields.io/badge/Better%20Auth-000000?style=for-the-badge)
![ElevenLabs](https://img.shields.io/badge/ElevenLabs-000000?style=for-the-badge)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)

## プロジェクト概要

PDF / テキストファイルから英文を抽出し、日本語訳付きの学習カード・シャドーイング用テキストにする Next.js アプリ。翻訳は Claude API、音声読み上げは ElevenLabs が担う。

Google ログインすると、処理結果(抽出した文とその翻訳)が Neon(Postgres)に自動保存される。未ログインでも抽出・翻訳・音声再生自体はそのまま利用できる。

## 使用技術一覧

| 種別 | 技術 |
|---|---|
| フレームワーク | Next.js 14 (App Router), React 18, TypeScript |
| スタイリング | Tailwind CSS |
| 翻訳 | Claude API(`@anthropic-ai/sdk`、Tool Use。既定モデル `claude-haiku-4-5-20251001`） |
| 認証 | Better Auth(Google OAuthのみ） |
| DB | Neon（サーバーレスPostgres。`@neondatabase/serverless`経由、ORM不使用） |
| 音声合成 | ElevenLabs API |
| PDF / OCR | pdf-parse、tesseract.js（テキストが取れない PDF への OCR フォールバック） |
| PDF出力 | html2canvas、jsPDF（抽出結果・シャドーイング用テキストのPDFダウンロード） |
| デプロイ先 | Vercel |

## 必要な環境変数

`.env.example` を `.env.local` にコピーして設定する。

| 変数 | 用途 |
|---|---|
| `ANTHROPIC_API_KEY` | 翻訳(Claude API)用キー |
| `ANTHROPIC_MODEL` | （任意）翻訳モデルの上書き。既定 `claude-haiku-4-5-20251001` |
| `ELEVENLABS_API_KEY` | 音声合成(ElevenLabs)用キー |
| `ELEVENLABS_VOICE_ID` | （任意）ElevenLabsのボイスID。未設定時はコード内既定値を使用 |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Neonの**所有者ロール**の接続文字列。`scripts/migrate.mjs`によるマイグレーション専用で、アプリの実行時コードからは使わない |
| `DATABASE_URL_APP` | アプリが実際に使う、権限を絞った`app_user`ロールの接続文字列。手動で取得するのではなく`scripts/migrate.mjs`の初回実行時に自動生成・書き込みされる(後述) |
| `BETTER_AUTH_SECRET` | Better Authのセッション暗号化用シークレット。`openssl rand -base64 32`で生成 |
| `BETTER_AUTH_URL` | アプリのURL(開発時は`http://localhost:3000`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuthログイン用 |

## 主要コマンド

| コマンド | 内容 |
|---|---|
| `npm install` | 依存パッケージのインストール |
| `npm run dev` | 開発サーバー起動（http://localhost:3000） |
| `npm run build` | 本番ビルド |
| `npm run start` | 本番サーバー起動 |
| `npm run lint` | ESLint 実行 |
| `node --env-file=.env.local scripts/migrate.mjs` | DBマイグレーション実行(初回セットアップ時のみ。後述) |

## ディレクトリ構成

```
.
├── db/
│   └── migrations/           # DBマイグレーションSQL(番号順に適用)
├── scripts/
│   └── migrate.mjs           # db/migrations/ を順に実行するセットアップ用スクリプト
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...all]/  # Better Authハンドラ
│   │   │   ├── documents/      # 処理結果(documents/sentences)の保存API
│   │   │   ├── extract/        # PDF/TXTからのテキスト抽出(OCRフォールバック含む)
│   │   │   ├── process/        # テキストのチャンク分割・翻訳(Claude API)
│   │   │   └── tts/            # ElevenLabs音声合成
│   │   ├── page.tsx           # トップページ(アップロード〜結果表示)
│   │   └── layout.tsx
│   ├── components/            # UIコンポーネント(Header, AuthButton, SentenceCard等)
│   ├── lib/                   # llm.ts(Claude API), auth.ts, db.ts, documents.ts, elevenlabs.ts等
│   └── types/                 # 共有型定義
└── .env.example
```

## 開発環境の構築手順

### 前提条件

- Node.js v20 以上(`package-lock.json` を使用。npm 想定。`scripts/migrate.mjs` が Node 標準の `--env-file` を使うため v20.6 以降が必要)
- Neonプロジェクト(DB用)
- Google CloudのOAuthクライアント(Googleログイン用)
- Anthropic・ElevenLabsのAPIキー

### 1. リポジトリをクローンし依存パッケージをインストール

```bash
git clone git@github.com:Masaharu1223/EnglishPDF_changer.git
cd EnglishPDF_changer
npm install
```

### 2. Neonプロジェクトを作成

[neon.com](https://neon.com) でプロジェクトを作成し、`DATABASE_URL`・`DATABASE_URL_UNPOOLED`(所有者ロールの接続文字列)を取得する。

> Vercel経由でNeonを使っている別プロジェクトが既にある場合、Neonのコンソールから直接新規プロジェクトを作成しようとすると `organization is managed by Vercel` というエラーになることがある。その場合はVercelダッシュボードの **Storage → Create Storage** から作成する(後述トラブルシューティング参照)。

### 3. Google OAuthクライアントを作成

Google Cloud Consoleで「Google Auth Platform」→「クライアント」から、アプリケーションの種類 **Web application** でOAuthクライアントを作成する。

- 承認済みのJavaScript生成元: `http://localhost:3000`
- 承認済みのリダイレクトURI: `http://localhost:3000/api/auth/callback/google`

### 4. 環境変数を設定

```bash
cp .env.example .env.local
```

`.env.local` を編集し、上記「必要な環境変数」のうち `DATABASE_URL_APP` 以外(`ANTHROPIC_API_KEY`・`ELEVENLABS_API_KEY`・`DATABASE_URL`・`DATABASE_URL_UNPOOLED`・`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`)を入力する。`BETTER_AUTH_SECRET` は `openssl rand -base64 32` で生成した値を、`BETTER_AUTH_URL` には `http://localhost:3000` を設定する。`DATABASE_URL_APP` は空のままでよい(次のステップで自動生成される)。

### 5. DBマイグレーションを実行

```bash
node --env-file=.env.local scripts/migrate.mjs
```

`db/migrations/` 配下のSQLを順に実行し、認証用テーブル・`documents`/`sentences`テーブル・RLSを設定したうえで、権限を絞った `app_user` ロールを作成する。生成したパスワードを含む接続文字列は **画面には出力されず**、`.env.local` の `DATABASE_URL_APP` に自動で書き込まれる。

> このスクリプトは冪等ではない。同じDBに対して2回実行すると `CREATE TABLE` 等で失敗する。

### 6. 開発サーバーを起動

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開く。

## 既知の制限・TODO

- 翻訳API(`/api/process`・`/api/tts`)は未ログインでも無制限に利用できる。公開運用する場合はサーバー側の利用回数制限が別途必要(未実装)
- ログイン中のユーザーが保存できる件数に上限がない(Neon無料枠の保護のため将来的に必要)
- 保存した処理結果を一覧・再表示する画面(`/history`)はまだない。現状は保存のみで、閲覧はDBを直接見る必要がある

## トラブルシューティング

### Neonで新規プロジェクトを作ろうとすると `organization is managed by Vercel` と出る

そのNeonアカウントが、別プロジェクトで既にVercel経由のNeon連携を使っている場合に起きる。Neonのコンソールからではなく、**Vercelダッシュボード → 対象プロジェクト → Storage → Create Storage** から作成する。

### 本番で `[BetterAuthError]: You are using the default secret. Please set 'BETTER_AUTH_SECRET'` が出る

Vercelの環境変数に `BETTER_AUTH_SECRET` が設定されていないか、設定後に**再デプロイしていない**ことが原因。Vercelは環境変数を保存した時点ではなく、デプロイ(ビルド)した時点で読み込むため、設定後は必ずRedeployが必要。

### 本番でGoogleログインを押しても何も起きない

`https://<プロジェクト名>-<ハッシュ>-<チーム名>.vercel.app` のような、デプロイごとに変わる個別URLからアクセスしている可能性がある。`BETTER_AUTH_URL` に設定した安定ドメイン(例: `https://english-pdf-changer.vercel.app`)からアクセスし直す。

### `scripts/migrate.mjs` が2回目の実行で失敗する

想定通りの挙動(上記「開発環境の構築手順」参照)。スクリプトは冪等ではないため、スキーマを作り直したい場合はNeon側でテーブル・ロールを手動で削除してから再実行する。

### 翻訳実行時にエラーが返る

`ANTHROPIC_API_KEY` が未設定、または無効になっていないか確認する。

### ログイン後にリダイレクトエラーになる

Google Cloud Console側の承認済みリダイレクトURIが、`BETTER_AUTH_URL`(例: `http://localhost:3000`)+`/api/auth/callback/google` と完全に一致しているか確認する。
