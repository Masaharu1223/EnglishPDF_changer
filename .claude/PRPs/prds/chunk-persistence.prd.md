# 生成済みチャンクの永続化(履歴保存)

## Problem Statement

ユーザーがアップロードした教材(PDF/テキスト)の翻訳結果を後から見返したり、音声を聞き直したりしたいとき、現状は保存の仕組みがないため同じファイルを再アップロード・再処理する必要がある。

## Evidence

- ユーザーがカスタマージャーニューとして「ソースの添付からチャンク生成、TTS化で音声も聞けるようになったユーザーは...再度音声を聞きたい場合でも聞けるようにデータベースに保存しておけるようにする」と明言(本会話)
- 既存の(未コミット)実装に`src/lib/db.ts`・`src/app/api/history/`・`src/components/HistoryList.tsx`という履歴機能の土台が既にあるが、現行の`supabase-schema.sql`はチャンクを`sentences JSONB`に1行でまとめる非正規化設計で、かつRLSが`OR true`で実質無効という問題を抱えている([[project_english_pdf_changer]]参照)

## Proposed Solution

Supabase(PostgreSQL)に`documents`(アップロード単位)と`chunks`(文単位の翻訳結果)の2テーブルを正規化して保存する。音声データ自体はDB/ストレージに保存せず、既存方針通り都度TTS APIを呼んで生成するオンデマンド方式を維持する。

## Key Hypothesis

We believe 処理結果(チャンク)をDBに保存しておくことが、同じ教材を繰り返し復習するユーザー体験を大きく改善すると信じている。
We'll know we're right when、一度処理した教材について、再訪問時に再アップロード・再処理なしで一覧表示・音声再生ができる状態になったとき。

## What We're NOT Building

- **音声データ自体の保存** - オンデマンド生成方式を維持するため、DB・ストレージのどちらにも音声ファイルは持たない(会話内で確認済み)
- **写真(画像)アップロード対応** - カスタマージャーニー確認の結果、対象外と決定(スクリプト前提のアプリのため)

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|---------------|
| チャンクの永続化 | アップロード済み教材を再訪問時に再処理なしで一覧表示できる | 実装後の動作確認 |
| RLSの安全性 | 他ユーザーの`documents`/`chunks`が閲覧・削除できない | RLSポリシーのテスト(別ユーザーでアクセスを試す) |

## Open Questions

- [ ] TTSアクセント(US/UK/AU)対応の要否は未回答のまま(会話内で説明したが、まだ意思決定されていない)
- [ ] `documents.raw_text`(抽出生テキスト)を保存する必要が本当にあるか。再チャンク分割・再翻訳に使う想定がなければ`chunks`だけで十分な可能性もある

---

## Data Model

### `documents`(1回のアップロード = 1行)

| 列名 | 型 | 内容 |
|---|---|---|
| `id` | bigint(identity, PK) | 主キー。テーブル全体を通した連番 |
| `user_id` | uuid | `auth.users(id)`への外部キー。どのユーザーのデータか |
| `title` | text | タイトル(ファイル名など、任意) |
| `source_type` | text | `'pdf'` または `'text'`(CHECK制約) |
| `raw_text` | text | 抽出された生のテキスト全文 |
| `created_at` | timestamptz | 作成日時 |

### `chunks`(1文 = 1行、`documents`に1対多で紐づく)

| 列名 | 型 | 内容 |
|---|---|---|
| `id` | bigint(identity, PK) | 主キー。テーブル全体を通した連番(`documents.id`とは別カウンター) |
| `document_id` | bigint | `documents(id)`への外部キー。所属する文書 |
| `user_id` | uuid | `auth.users(id)`への外部キー。RLS高速化のため`documents`から非正規化して直接保持 |
| `position` | integer | 文書内での順番(0始まり、文書ごとにリセット) |
| `original` | text | 英文原文 |
| `translation` | text | 日本語訳 |
| `created_at` | timestamptz | 作成日時 |

`unique (document_id, position)`制約で、同じ文書内の重複挿入を防止する。

### DDL

```sql
create table documents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  source_type text not null check (source_type in ('pdf', 'text')),
  raw_text text not null,
  created_at timestamptz not null default now()
);

create index documents_user_id_idx on documents (user_id);

create table chunks (
  id bigint generated always as identity primary key,
  document_id bigint not null references documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null,
  original text not null,
  translation text not null,
  created_at timestamptz not null default now(),
  unique (document_id, position)
);

create index chunks_document_id_idx on chunks (document_id);
create index chunks_user_id_idx on chunks (user_id);

alter table documents enable row level security;
alter table chunks enable row level security;

create policy "select own documents" on documents for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "insert own documents" on documents for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "delete own documents" on documents for delete
  to authenticated using ((select auth.uid()) = user_id);

create policy "select own chunks" on chunks for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "insert own chunks" on chunks for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "delete own chunks" on chunks for delete
  to authenticated using ((select auth.uid()) = user_id);
```

---

## Users & Context

**Primary User**: [[api-pivot-long-form]]と共通。開発者本人、英語のPDF/テキスト教材・YouTube文字起こしを読む人。

**Job to Be Done**: 一度処理した教材を後日また見返したいので、再アップロードなしで過去の翻訳結果・音声を確認できるようにしたい。

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | `documents`テーブルでアップロード単位のメタデータを保存 | 履歴一覧の表示単位 |
| Must | `chunks`テーブルで文単位の翻訳結果を保存 | 再訪問時に再処理なしで表示するための核心 |
| Must | RLSで他ユーザーのデータにアクセスできないようにする | 既存実装の既知の脆弱性(`OR true`)を今回で解消する |
| Won't | 音声データの保存 | オンデマンド生成方式を維持 |

---

## Technical Approach

**Feasibility**: HIGH

**Architecture Notes**
- `@supabase/supabase-js`は既に`package.json`に依存関係として存在する
- 既存の`supabase-schema.sql`(`extractions`テーブル、JSONB非正規化、RLS実質無効)を本設計で置き換える
- 既存の`src/lib/db.ts`・`src/app/api/history/`・`src/components/HistoryList.tsx`は新しいテーブル構造に合わせて書き換えが必要

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 既存の`extractions`テーブル前提で書かれた`db.ts`等のコードとの不整合 | M | スキーマ変更と同時にアプリ側コードも書き換える(実装フェーズで対応) |

---

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | スキーマ更新 | `supabase-schema.sql`を本設計(`documents`/`chunks`+RLS)に置き換える | pending | - | - | - |
| 2 | アプリ側コード更新 | `db.ts`・`/api/history`・`HistoryList.tsx`を新テーブル構造に合わせて書き換える | pending | - | 1 | - |
| 3 | RLS検証 | 別ユーザーでアクセスを試し、他人のデータが見えない・消せないことを確認する | pending | - | 1, 2 | - |

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| テーブル構造 | `documents`+`chunks`の2テーブル正規化 | `extractions`のような単一テーブル+JSONB | チャンク単位でのクエリ・整合性チェックがしやすいため(会話内で決定) |
| 主キー型 | `bigint generated always as identity` | ランダムUUID(v4) | 単一DB構成のためインデックス断片化のないbigintが適切(Supabase公式ベストプラクティスに準拠) |
| `chunks.user_id`の扱い | `documents`から非正規化してchunksにも直接持たせる | `document_id`経由のJOINで都度参照 | RLSポリシーのパフォーマンス向上のため |
| 音声データの永続化 | しない(都度生成) | Supabase Storageに保存 | オンデマンド方式を維持し、ストレージ管理の複雑さを避けるため(会話内で確認済み) |

---

*Generated: 2026-09-02*
*Status: DRAFT - needs validation*
