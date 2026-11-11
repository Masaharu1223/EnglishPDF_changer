-- 翻訳1件ごとのチケット(Issue #54)。最初にテキストを受け取ったときにセッションが有効なら発行し、
-- 以降の翻訳と履歴への保存を、セッションが切れていてもログイン者として扱うために使う。
--
-- token_hash  トークン(32バイトの乱数)の SHA-256。トークンそのものは保存しない
-- subject_type 発行時の利用者の種類('owner' / 'user')。途中で許可リストが変わっても固定
-- budget_chars このチケットで翻訳できる文字数(各チャンクの max(文字数, 最低課金文字数) の合計)
-- used_chars  翻訳で使った文字数
-- raw_text_hash 翻訳する本文(cleanText 前)の SHA-256。保存時に照合する
-- chunk_hashes 各チャンクの SHA-256。翻訳時に照合し、盗まれたチケットで別の文章を翻訳させない
-- expires_at  発行から24時間。翻訳時間の見積もりではなく、使われずに残ったチケットの後片付けの上限
-- consumed_at 保存したか、上限に達して打ち切ったときに入る。入ったら使えない
--
-- 利用者の文章は保存しない(ハッシュだけ)。

create table translation_tickets (
  id            bigint generated always as identity primary key,
  token_hash    text        not null unique,
  user_id       text        not null references users (id) on delete cascade,
  subject_type  text        not null check (subject_type in ('owner', 'user')),
  budget_chars  integer     not null check (budget_chars > 0),
  used_chars    integer     not null default 0 check (used_chars >= 0 and used_chars <= budget_chars),
  raw_text_hash text        not null,
  chunk_hashes  text[]      not null,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- sessions への外部キーは張らない。Better Auth は、期限切れのクッキーが届いた時点で
-- セッションの行を削除するため、cascade にするとセッションが切れた瞬間にチケットも消える。

-- 発行時に、同じユーザーの期限切れの行を消すための索引
create index translation_tickets_user_expires_idx on translation_tickets (user_id, expires_at);

-- delete は、期限切れの行の掃除のために付与する(usage は掃除を所有者ロールで行うため付与していない)。
grant select, insert, update, delete on translation_tickets to app_user;

-- RLS は有効にしない。チケットは token_hash で検索するため、検索する時点では user_id が分からず、
-- set_config('app.user_id', ...) による行単位の制限が成り立たない(usage と同じ理由)。
-- アクセスは app_user の権限(上の grant)とアプリ側の責務で制限する。
