# PDF Exchange English

![Next.js](https://img.shields.io/badge/next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/-ReactJs-61DAFB?logo=react&logoColor=white&style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-000000?style=for-the-badge&logo=ollama&logoColor=white)
![NextAuth.js](https://img.shields.io/badge/NextAuth.js-7C3AED?style=for-the-badge)
![ElevenLabs](https://img.shields.io/badge/ElevenLabs-000000?style=for-the-badge)

## プロジェクト概要

PDF / テキストファイルから英文を抽出し、日本語に翻訳して学習カード化する Next.js アプリ。翻訳は外部 API を使わずローカルで動く **Ollama** が処理するため、翻訳自体には API キー不要・従量課金なしで動作する。

Google / LINE ログイン、抽出履歴の保存（Supabase）、無料・有料ティア別の音声読み上げ（無料: ブラウザの Web Speech API / 有料: ElevenLabs）を備える。

## 使用技術一覧

| 種別 | 技術 |
|---|---|
| フレームワーク | Next.js 14 (App Router), React 18, TypeScript |
| スタイリング | Tailwind CSS |
| 翻訳 LLM | Ollama（OpenAI 互換 API 経由、`openai` SDK を利用） |
| 認証 | NextAuth.js v5（Google OAuth / LINE Login） |
| DB | Supabase（抽出履歴の保存） |
| 音声合成 | Web Speech API（無料ティア）/ ElevenLabs（有料ティア） |
| PDF / OCR | pdf-parse、tesseract.js（テキストが取れない PDF への OCR フォールバック） |

## 必要な環境変数

`.env.example` を `.env.local` にコピーして設定する。

| 変数 | 用途 |
|---|---|
| `OLLAMA_BASE_URL` | Ollama サーバーの URL（既定 `http://localhost:11434`） |
| `OLLAMA_MODEL` | 翻訳に使う Ollama モデル名（後述「モデルの選択」参照） |
| `ELEVENLABS_API_KEY` | 有料ティアの音声合成（ElevenLabs）用 API キー |
| `ELEVENLABS_VOICE_ID` | （任意）ElevenLabs のボイス ID。未設定時はコード内既定値を使用。`.env.example` には未記載なので必要なら追記する |
| `NEXTAUTH_SECRET` | NextAuth のセッション暗号化用シークレット。`openssl rand -base64 32` で生成 |
| `NEXTAUTH_URL` | アプリの URL（開発時は `http://localhost:3000`） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth ログイン用（必須） |
| `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` | LINE Login 用（任意。未設定なら LINE ログインは無効化される） |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | 抽出履歴を保存する Supabase プロジェクトの接続情報 |

## 主要コマンド

| コマンド | 内容 |
|---|---|
| `npm install` | 依存パッケージのインストール |
| `npm run dev` | 開発サーバー起動（http://localhost:3000） |
| `npm run build` | 本番ビルド |
| `npm run start` | 本番サーバー起動 |
| `npm run lint` | ESLint 実行 |

## ディレクトリ構成

```
.
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/  # NextAuth ハンドラ
│   │   │   ├── extract/             # PDF/TXT からのテキスト抽出（OCR フォールバック含む）
│   │   │   ├── process/             # テキストのチャンク分割・翻訳
│   │   │   ├── tts/                 # ElevenLabs 音声合成（有料ティア）
│   │   │   └── history/             # 抽出履歴の CRUD（Supabase）
│   │   ├── history/                 # 履歴一覧ページ（要ログイン）
│   │   ├── page.tsx                 # トップページ（アップロード〜結果表示）
│   │   ├── layout.tsx / providers.tsx
│   │   └── globals.css
│   ├── components/                  # UI コンポーネント（Header, AuthButton, SentenceCard 等）
│   ├── lib/                         # llm.ts（Ollama 呼び出し）, auth.ts, db.ts, usage.ts, elevenlabs.ts, pdf-parser.ts
│   └── types/                       # 共有型定義
├── supabase-schema.sql              # Supabase 側で実行するテーブル定義（extractions）
└── .env.example
```

## 開発環境の構築手順

### 前提条件

- Node.js（`package-lock.json` を使用。npm 想定）
- Ollama（翻訳 LLM をローカルで動かすため）
- Supabase プロジェクト（履歴保存用）
- Google Cloud のOAuth クライアント（Google ログイン用）

### 1. Ollama を用意

ネイティブアプリ（Mac で GPU/Metal を使え高速）か Docker のどちらでも可。

**ネイティブ（推奨・高速）:**
```bash
brew install ollama
ollama serve            # http://localhost:11434 で待ち受け
ollama pull qwen2.5:7b  # 約 4.7GB
```

**Docker:**
```bash
docker run -d --name ollama-server -p 11434:11434 ollama/ollama
docker exec ollama-server ollama pull qwen2.5:7b
```
> 注: macOS の Docker は GPU(Metal) を使えないため CPU 実行になり遅くなります。速度重視ならネイティブ版を使ってください。

### 2. Supabase のセットアップ

Supabase プロジェクトの SQL Editor で `supabase-schema.sql` を実行し、`extractions` テーブルを作成する。

> **注意**: 現状のスキーマの RLS ポリシーは `USING (... OR true)` / `WITH CHECK (true)` となっており、実質的に誰でも全ユーザーの履歴を読み書き・削除できてしまう。本番運用前に `user_id` ベースの制限に修正が必要。

### 3. OAuth の設定

- **Google**: Google Cloud Console で OAuth クライアントを作成し、リダイレクト URI に `http://localhost:3000/api/auth/callback/google` を追加
- **LINE**（任意）: LINE Developers で LINE Login チャネルを作成し、コールバック URL に `http://localhost:3000/api/auth/callback/line` を追加

### 4. 環境変数を設定

```bash
cp .env.example .env.local
# .env.local を編集して上記「必要な環境変数」を入力
```

### 5. 依存パッケージのインストールと起動

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開く。

## モデルの選択

| モデル | サイズ | 特徴 |
|---|---|---|
| `qwen2.5:7b` | 約 4.7GB | 日本語翻訳のバランスが良い（README 上の既定） |
| `qwen2.5:14b` | 約 9GB | さらに高精度・要メモリ |
| `gemma3:4b` | 約 3.3GB | 軽量 |
| `llama3.2:3b` | 約 2GB | 高速だが日本語は不安定（コード上のフォールバック既定） |

`OLLAMA_MODEL` を変えるだけで切り替わる（モデルは事前に `ollama pull` しておくこと）。

## 公開（ポートフォリオ用途）

Vercel など PaaS にデプロイすると、そのサーバーから `localhost` の Ollama には届かない。ローカルの Ollama を使ったまま公開するには、Ollama を外部公開してトンネル経由でアクセスさせる:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:11434
# 発行された https://xxxx.trycloudflare.com を OLLAMA_BASE_URL に設定
```

> ローカルマシンが起動・Ollama 稼働中のときだけ動作する。常時稼働サイトには不向き、デモ用途向け。

## 既知の制限・TODO

- 無料/有料ティアの判定は `localStorage` のみで管理しており、サーバー側の検証がない（ブラウザの開発者ツールで簡単に回避できる）
- 有料ティアへのアップグレード導線はダミー（`alert()` のみで決済は未実装）
- Supabase の RLS ポリシーが実質無効化されている（上記「Supabase のセットアップ」参照）
- `@auth/supabase-adapter` は依存関係に入っているが未使用（NextAuth はデータベースアダプタなしの JWT セッションのみ）
- `@anthropic-ai/sdk` は依存関係に残っているが、翻訳処理は Ollama に置き換わり済みで未使用

## トラブルシューティング

### `npm run dev` / `npm run build` が失敗する（構文エラー）

現状 `src/components/AuthButton.tsx` の JSX に構文エラーがあり（`{session.user.image && ( {/* コメント */} <img ... /> )}` のように、JS 式の中に単独の JSX コメントを挟んでしまっている箇所がある）、`tsc --noEmit` でエラーになる。`AuthButton` を使う画面（`Header` 経由でほぼ全ページ）のビルドが通らないため、開発を始める前に該当コメントを `<img>` タグの直前に移す（または削除する）修正が必要。

### 翻訳実行時に「Failed to process text with the local LLM.」が返る

`/api/process` の翻訳処理が失敗している。多くの場合 Ollama が起動していない・`OLLAMA_MODEL` で指定したモデルを `ollama pull` していないことが原因。`ollama serve` が起動しているか、`ollama list` でモデルが存在するかを確認する。

### ログイン後にリダイレクトエラーになる（OAuth）

Google Cloud Console / LINE Developers 側のリダイレクト URI・コールバック URL が `NEXTAUTH_URL`（例: `http://localhost:3000`）と一致していないことが多い。`/api/auth/callback/google`・`/api/auth/callback/line` のパスで正確に一致させる。

### 履歴が保存・表示されない

`SUPABASE_URL` / `SUPABASE_ANON_KEY` が未設定、または Supabase 側で `supabase-schema.sql` を実行していないことが多い。ブラウザの開発者ツールで Supabase へのリクエストが 401/404 になっていないか確認する。
