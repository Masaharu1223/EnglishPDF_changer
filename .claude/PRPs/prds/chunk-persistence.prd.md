# 生成済み文の永続化(履歴保存)

## Problem Statement

ユーザーがアップロードした教材(PDF/テキスト)の翻訳結果を後から見返したり、音声を聞き直したりしたいとき、現状は保存の仕組みがないため同じファイルを再アップロード・再処理する必要がある。

## Evidence

- ユーザーがカスタマージャーニューとして「ソースの添付からチャンク生成、TTS化で音声も聞けるようになったユーザーは...再度音声を聞きたい場合でも聞けるようにデータベースに保存しておけるようにする」と明言(会話内)
- 直近の応急処置として、同一タブ内でのリロード消失は`sessionStorage`で解消済み(PR #30, `fix/session-storage-persistence`)。ただし同一タブ限定で、別端末・再訪問時には引き続き結果が残らない。本PRDはその恒久対応にあたる
- 以前(2026年9月)一度ほぼ同じ設計検討を行っていたが、認証基盤を含む決定内容がコミットされないまま`git stash`に埋もれて失われていた経緯がある。本改訂はその教訓を踏まえ、実装着手前にPRDを先にコミットするもの

## Proposed Solution

Neon(サーバーレスPostgres)上に`documents`(アップロード単位)と`sentences`(文単位の翻訳結果)の2テーブルを正規化して保存する。認証はBetter Auth(OSS、Googleログイン)を導入し、ユーザー・セッション情報も同じNeon DBに保存する。音声データ自体はDB/ストレージに保存せず、既存方針通り都度TTS APIを呼んで生成するオンデマンド方式を維持する。

## Key Hypothesis

We believe 処理結果(文)をDBに保存しておくことが、同じ教材を繰り返し復習するユーザー体験を大きく改善すると信じている。
We'll know we're right when、一度処理した教材について、別端末から再訪問しても再アップロード・再処理なしで一覧表示・音声再生ができる状態になったとき。

## What We're NOT Building

- **音声データ自体の保存** - オンデマンド生成方式を維持するため、DB・ストレージのどちらにも音声ファイルは持たない(会話内で確認済み)
- **PDFファイルの原本自体の保存** - `raw_text`(抽出済み生テキスト)のみで学習用途には十分なため不要と確認済み。ストレージ容量・著作権懸念も避けられる
- **写真(画像)アップロード対応** - カスタマージャーニー確認の結果、対象外と決定(スクリプト前提のアプリのため)
- **翻訳API(`/api/process`, `/api/tts`)の無認証利用回数制限** - 公開運用にする以上将来的には必要になるが、今回のDB構築のスコープ外。後回しと確定(会話内で確認済み)。`api-pivot-long-form.prd.md`の「公開時のサーバー側利用回数制限」が該当
- **途中保存・処理再開機能** - 保存は翻訳完了時の一括のみ。処理中にタブを閉じた場合の再開機能はセットで作らない限り価値が薄いため今回は見送る
- **ブックマーク・習熟度などの学習記録機能** - 今回は対象外。将来`sentences.id`へのFKで追加でき、スキーマ変更は不要なため後回しにしても困らない
- **翻訳に使ったモデル名の記録** - 必要になれば列を1つ足すだけなのでv1では省略

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|---------------|
| 文の永続化 | アップロード済み教材を再訪問時に再処理なしで一覧表示できる | 実装後の動作確認 |
| 別端末での再現性 | 別のGoogleアカウントでログインした別端末から、同じ履歴が見られる | 実機確認(別アカウント・別ブラウザ) |
| アクセス制御の安全性 | 他ユーザーの`documents`/`sentences`が閲覧・挿入・削除できない | RLSポリシーのテスト(別ユーザーでアクセスを試す) |

## Open Questions

- [x] ~~TTSアクセント(US/UK/AU)対応の要否~~ → **決定: アメリカ英語のみ対応**
- [x] ~~`documents.raw_text`(抽出生テキスト)を保存する必要が本当にあるか~~ → **決定: 保存する**。再チャンク分割・再翻訳の元データとしても使えるため
- [x] ~~認証基盤: NextAuth × Supabase RLSの不整合~~ → **決定: Better Auth + Neon**(経緯はDecisions Log参照。旧「案B: NextAuth + service_role」は撤回)
- [x] ~~DBホスティング先(Supabase/Neon/AWS)~~ → **決定: Neon**。Decisions Log参照
- [x] ~~サインアップ方針(自分専用/公開)~~ → **決定: 公開(誰でもGoogleログイン可)**

---

## Data Model

全部で6テーブル。`users`/`sessions`/`accounts`/`verifications`はBetter Authが自動生成し(Better Auth CLIの`generate`コマンドで作成、手書きしない)、`documents`/`sentences`が今回新設するアプリ本体。

### `users` / `sessions` / `accounts` / `verifications`(Better Auth自動生成)

| テーブル | 主キー | 外部キー | 役割 |
|---|---|---|---|
| `users` | `id`(text) | なし | ログインユーザー本体(email, name, image等) |
| `sessions` | `id` | `user_id` → `users.id` | ログインセッション(Cookieと紐づく) |
| `accounts` | `id` | `user_id` → `users.id` | 外部プロバイダ(Google)との連携情報 |
| `verifications` | `id` | なし | メール確認等のトークン。Googleログインのみの本アプリではほぼ未使用 |

### `documents`(1回のアップロード = 1行)

| 列名 | 型 | 内容 |
|---|---|---|
| `id` | bigint(identity, PK) | 主キー。連番 |
| `user_id` | text | `users.id`への外部キー。NextAuthではなくBetter Authのユーザーidなのでtext型 |
| `title` | text | タイトル(ファイル名など)。NOT NULL |
| `source_type` | text | `'pdf'` / `'txt'` / `'paste'`(CHECK制約)。実際の入力経路(PDFファイル・TXTファイル・テキスト貼り付け)に対応 |
| `raw_text` | text | 抽出された生のテキスト全文。NOT NULL、最大20万字のCHECK制約(公開運用での濫用対策) |
| `created_at` | timestamptz | 作成日時。[[date-time-handling-standards]]に従い内部は常にUTC |

`unique (id, user_id)` 制約を持つ。`sentences`側からの複合外部キーの参照先になる。

### `sentences`(1文 = 1行、`documents`に1対多で紐づく)

| 列名 | 型 | 内容 |
|---|---|---|
| `id` | bigint(identity, PK) | 主キー。連番(`documents.id`とは別カウンター) |
| `document_id` | bigint | `documents(id)`への外部キー。所属する文書 |
| `user_id` | text | `document_id`とセットで`documents(id, user_id)`を参照する複合外部キーの一部(単独でusersを参照するものではない) |
| `position` | integer | 文書内での順番(0始まり、文書ごとにリセット)。CHECK制約で0以上 |
| `original` | text | 英文原文。NOT NULL |
| `translation` | text | 日本語訳。NOT NULL |
| `created_at` | timestamptz | 作成日時 |

`unique (document_id, position)`制約で同じ文書内の順番重複を防止。`foreign key (document_id, user_id) references documents (id, user_id)`という複合外部キーにより、「`document_id`は合っているが`user_id`が食い違う」矛盾した行の挿入をDB構造自体が拒否する(他人の文書に文が紛れ込むことを防ぐ安全装置)。

### DDL(骨子。認証系4テーブルはBetter Auth CLIが生成するSQLを別途使う)

```sql
create table documents (
  id          bigint generated always as identity primary key,
  user_id     text not null references users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  source_type text not null check (source_type in ('pdf', 'txt', 'paste')),
  raw_text    text not null check (char_length(raw_text) <= 200000),
  created_at  timestamptz not null default now(),
  constraint documents_id_user_id_key unique (id, user_id)
);

create index documents_user_id_created_at_idx on documents (user_id, created_at desc);

create table sentences (
  id          bigint generated always as identity primary key,
  document_id bigint not null,
  user_id     text not null,
  position    integer not null check (position >= 0),
  original    text not null,
  translation text not null,
  created_at  timestamptz not null default now(),
  constraint sentences_document_id_position_key unique (document_id, position),
  constraint sentences_document_owner_fkey foreign key (document_id, user_id)
    references documents (id, user_id) on delete cascade
);

alter table documents enable row level security;
alter table sentences enable row level security;

-- アプリ接続用の専用ロール。Vercelにはこのロールの接続文字列のみ置き、
-- マイグレーション専用の所有者ロールの接続文字列は置かない
create role app_user login;
grant usage on schema public to app_user;
grant select, insert, delete on documents to app_user;
grant select, insert on sentences to app_user;
grant usage on all sequences in schema public to app_user;

-- auth.uid()相当がNeonには無いため、トランザクション内でset_configした値と照合する方式
create policy "documents_select_own" on documents for select to app_user
  using (user_id = nullif(current_setting('app.user_id', true), ''));
create policy "documents_insert_own" on documents for insert to app_user
  with check (user_id = nullif(current_setting('app.user_id', true), ''));
create policy "documents_delete_own" on documents for delete to app_user
  using (user_id = nullif(current_setting('app.user_id', true), ''));

create policy "sentences_select_own" on sentences for select to app_user
  using (user_id = nullif(current_setting('app.user_id', true), ''));
create policy "sentences_insert_own" on sentences for insert to app_user
  with check (user_id = nullif(current_setting('app.user_id', true), ''));
-- updateポリシーは作らない(保存後は変更しない)。sentencesの削除はdocumentsからのcascadeに任せる
```

### 保存方式(RPC関数ではなくCTEで1トランザクション)

```sql
-- アプリ側は1リクエストの中で BEGIN → set_config('app.user_id', ...) →
-- 以下のCTE → COMMIT を実行する
with new_document as (
  insert into documents (user_id, title, source_type, raw_text)
  values ($1, $2, $3, $4)
  returning id
)
insert into sentences (document_id, user_id, position, original, translation)
select nd.id, $1, s.position, s.original, s.translation
from new_document nd,
     jsonb_to_recordset($5) as s(position int, original text, translation text);
```

空配列や文字数超過はアプリ側で事前に検証してから実行する。

---

## Users & Context

**Primary User**: [[api-pivot-long-form]]と共通。英語のPDF/テキスト教材・YouTube文字起こしを読む人。公開運用のため、開発者本人以外のユーザーも対象になる。

**Job to Be Done**: 一度処理した教材を後日また見返したいので、再アップロードなしで過去の翻訳結果・音声を確認できるようにしたい。

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Googleログイン(Better Auth) | 複数端末での履歴アクセスに認証が必須 |
| Must | `documents`テーブルでアップロード単位のメタデータを保存 | 履歴一覧の表示単位 |
| Must | `sentences`テーブルで文単位の翻訳結果を保存 | 再訪問時に再処理なしで表示するための核心 |
| Must | RLS + 複合外部キーで他ユーザーのデータにアクセス・混入できないようにする | 既存実装(旧`extractions`)の既知の脆弱性(`OR true`)を今回で解消する |
| Should | ユーザーごとの保存件数上限 | 公開運用でNeon無料枠(0.5GB)を守るため |
| Won't | 音声データ・PDF原本の保存 | オンデマンド方式・raw_textのみで十分なため |

### MVP Scope

Googleログインでき、処理完了後の`sentences`が`documents`とともにNeonに保存され、`/history`から再訪問時に再処理なしで一覧・詳細表示できる状態。

### User Flow

(未ログイン)PDF/テキストをアップロード・処理・結果表示 → 従来通り動作、ログイン不要
(ログイン済み)同じ処理フロー → 完了時に自動でDBへ保存 → `/history`から過去の教材を一覧・再表示・音声再生

---

## Technical Approach

**Feasibility**: HIGH

**Architecture Notes**
- 認証はBetter Auth(OSS、`better-auth`パッケージ)。NextAuth/Supabase Authは不採用(Decisions Log参照)
- DBはNeon(`@neondatabase/serverless`)。`documents`/`sentences`のRLSは`auth.uid()`ではなく、トランザクション内で`set_config('app.user_id', ...)`した値と照合する方式
- 読み取りはServer Component、書き込みはRoute Handler(`/api/documents`)で行う。Server Actionsは既存コードベースで未使用のため今回も導入しない
- `/api/process`・`/api/tts`は無変更。未ログインでも従来通り動作する(DBに一切触れない)
- `page.tsx`の`processText`はstale closure対策として、ループ内でローカル配列にも結果を貯めてから保存処理に渡す必要がある

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Neonの無料枠(月の計算時間)を使い切ると翌月まで計算資源が止まる | L | 未ログイン訪問者のアクセスはDBに一切触れない設計にする(翻訳機能はそもそもDB非依存)。死活監視もDBを叩かない |
| プレビュー環境(Vercel)でのGoogle OAuthが動作しない | M | GoogleはリダイレクトURIのワイルドカードを許可しないため。ローカル・本番でのみ動作確認する、または`oAuthProxy`プラグインを検討 |
| 保存失敗がユーザー体験を損なう | L | 保存の失敗は致命的エラーにしない。Neon/Better Authが止まっていても翻訳機能自体は従来通り動くようにする |
| 公開運用でのストレージ圧迫 | M | ユーザーごとの保存件数上限を設ける(Should) |

---

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends |
|---|-------|-------------|--------|----------|---------|
| 0 | PRD改訂・コミット | 本ドキュメントの更新(本PR) | in-progress | - | - |
| 1 | Neon側の構築 | Neonプロジェクト作成、マイグレーションSQL(認証+`documents`/`sentences`+ロール/RLS)、Google OAuth設定 | pending | - | 0 |
| 2 | 認証の組み込み | Better Auth導入、`AuthButton`/`Header`、`/api/auth/[...all]` | pending | - | 1 |
| 3 | 保存の流れ | `src/lib/documents.ts`(リポジトリ層)、`POST /api/documents`、`page.tsx`から保存呼び出し | pending | - | 2 |
| 4 | 履歴画面 | `/history`(一覧)、`/history/[id]`(詳細)、`DeleteDocumentButton` | pending | - | 3 |
| 5 | 検証とドキュメント | RLS検証(別アカウントでアクセス試行)、README更新、`.env.example`新設 | pending | - | 4 |

PRは目安としてPhase0(本PR)・Phase1-2(`feature/neon-auth`)・Phase3(`feature/save-history`)・Phase4-5(`feature/history-ui`)の4本に分ける。

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| テーブル構造 | `documents`+`sentences`の2テーブル正規化 | 単一テーブル+JSONB(旧`extractions`) | 文単位でのクエリ・整合性チェック(重複防止・型保証)がしやすいため。将来の文単位機能追加も容易 |
| 主キー型 | `bigint generated always as identity` | ランダムUUID(v4) | 単一DB構成のためインデックス断片化のないbigintが適切 |
| テーブル名 | `sentences`(旧`chunks`から改名) | `chunks`のまま | コード上の「チャンク」(約1,500文字の処理単位、`splitIntoChunks`)と意味が衝突するため。1行=1文という実態に合わせた |
| `source_type`の値 | `'pdf'` / `'txt'` / `'paste'`の3値 | `'pdf'` / `'text'`の2値(旧案) | 実際の入力経路(PDFファイル・TXTファイル・貼り付け)に対応させるため |
| DBホスティング | **Neon**(サーバーレスPostgres) | Supabase / AWS(RDS, Aurora Serverless v2) | 公開運用になったため、Supabase無料枠の「7日無アクセスでプロジェクト全体が一時停止・手動復旧」は他ユーザーにも影響する障害になり許容できない。Neonは計算資源のみ自動停止・次接続で自動再開(手動操作不要)。AWSはRDSで月18ドル〜、Aurora Serverless v2でも再開に約15秒かかり構成部品も最多(IaC導入が必要)で、AWS習得が目的でない限り合理性がない。`architect`サブエージェントでの検討結果 |
| 認証基盤 | **Better Auth**(OSS、Googleのみ) | NextAuth(旧「案B」)/ Supabase Auth / Clerk / AWS Cognito | 旧案Bは「既存のNextAuth実装を活かす」が前提だったが、現在のmainにNextAuthは存在せず前提が崩れている。Supabase Authは上記理由でDB自体を不採用としたため連動して不採用。ClerkはLINEログイン不要と確定した今、1〜少人数規模には過剰でベンダーも増える。AWS CognitoはDBにusersテーブルを持てずFKが張れない。Better Authはユーザー/セッションを同じNeon DBに置けFKで整合性を保てる上、OSSで0円。`architect`サブエージェントでの検討結果 |
| RLSの方式 | `set_config('app.user_id', ...)`方式 | Supabaseの`auth.uid()`方式(旧DRAFT版) | Neon採用に伴い`auth.uid()`相当が無いため。アプリ側で接続時に明示的に設定する方式に変更 |
| 保存タイミング | 翻訳完了時に1回、1トランザクションで一括保存 | チャンク(処理単位)ごとに逐次保存 | 「処理中」という中途半端な状態の文書が発生しない。将来の並列翻訳化(api-pivot Phase 3)の影響も受けない |
| サインアップ方針 | 公開(誰でもGoogleログイン可) | 自分専用(新規サインアップ無効化) | 会話内で確定。公開運用に伴いNeon選定・保存上限等の設計判断に影響している |
| `chunks.user_id`の扱い | `documents`から非正規化して`sentences`にも直接持たせ、複合外部キーで整合性を保証 | `document_id`経由のJOINで都度参照 | RLSポリシーのパフォーマンス向上に加え、複合外部キーにより「所有者の矛盾したデータ」をDB構造自体で挿入拒否できるため |
| 音声データの永続化 | しない(都度生成) | Supabase Storage等に保存 | オンデマンド方式を維持し、ストレージ管理の複雑さを避けるため |
| PDF原本の永続化 | しない。`raw_text`のみ保存 | Supabase Storage等に原本バイナリを保存 | 学習用途は`raw_text`で足りる。著作権懸念・ストレージ容量も避けられる |
| 日付・時刻の扱い | [[date-time-handling-standards]]に従う(UTC保存・ISO 8601・ライブラリ活用・UIでタイムゾーン明示) | 独自実装 | プロジェクト全体の恒久ルールとして確定 |

---

*Generated: 2026-09-02*
*Updated: 2026-10-04 — DBホスティング・認証基盤をNeon + Better Authに全面変更、テーブル名をsentencesに改名、公開運用前提での設計に更新*
*Status: 設計確定。実装フェーズ(Phase 1)着手可能*
