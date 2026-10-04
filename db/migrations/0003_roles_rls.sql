-- アプリ接続専用ロール。パスワードは実行時にスクリプトが生成・置換する
-- (このファイルにパスワードの実値はコミットしない)。
create role app_user login password '__APP_USER_PASSWORD__';

grant usage on schema public to app_user;
grant select, insert, update, delete on users, sessions, accounts, verifications to app_user;
grant select, insert, delete on documents to app_user;
grant select, insert on sentences to app_user;
grant usage on all sequences in schema public to app_user;

alter table users enable row level security;
alter table sessions enable row level security;
alter table accounts enable row level security;
alter table verifications enable row level security;
alter table documents enable row level security;
alter table sentences enable row level security;

-- 認証系4テーブルはBetter Auth自身が自分のuserIdに基づいて読み書きするため、
-- app_userに対しては全件許可(アプリ側の責務)。documents/sentencesのみ
-- set_config('app.user_id', ...) による行単位の制限を行う。
create policy "auth_tables_app_user_all" on users for all to app_user using (true) with check (true);
create policy "auth_tables_app_user_all" on sessions for all to app_user using (true) with check (true);
create policy "auth_tables_app_user_all" on accounts for all to app_user using (true) with check (true);
create policy "auth_tables_app_user_all" on verifications for all to app_user using (true) with check (true);

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
