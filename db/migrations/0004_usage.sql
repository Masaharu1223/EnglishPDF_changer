-- 利用制限(翻訳APIの回数制限)用の使用量テーブル。tasks/todo.md の手順3に対応する。
--
-- subject_key は「誰の使用量か」を表す文字列で、認証済み・未認証を同じ表で扱う:
--   'u:<users.id>'   ログイン済みユーザー個人
--   'ip:<ハッシュ>'  未認証のクライアントIP(生のIPは保存しない。IPv6は/64でまとめる)
--   'anon:*'         未認証ユーザー全体の合計(全体の日次上限用)
--   'auth:*'         ログイン済みユーザー全体の合計(安全装置用)
-- 種類が混在するため users(id) への外部キーは張らない。
--
-- day は UTC の日付。日付・時刻の規約に従い、保存はUTC、画面表示でJSTを明示する。
-- kind は使用量の種別('translate_chars' など)。amount は文字数の累計。

create table usage (
  subject_key text        not null,
  day         date        not null,
  kind        text        not null,
  amount      integer     not null default 0 check (amount >= 0),
  updated_at  timestamptz not null default now(),
  primary key (subject_key, day, kind)
);

-- 原子的な予約は INSERT ... ON CONFLICT DO UPDATE ... WHERE で行うため、
-- insert/update に加えて WHERE で amount を参照する select が必要。
-- delete は付与しない(古い行の掃除は所有者ロールで別途行う)。
grant select, insert, update on usage to app_user;

-- RLSは有効にしない。documents/sentences は「自分の行だけ」という行単位の制限が
-- 要件だが、usage は未認証の主体(IP・全体合計)も扱うため user_id に基づく行制限が
-- 成り立たない。アクセスは app_user の権限(上のgrant)とアプリ側の責務で制限する。
