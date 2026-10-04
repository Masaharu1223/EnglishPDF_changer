-- アプリ本体のテーブル。chunk-persistence.prd.md のDDLに対応する。
-- users(id) は 0001_auth.sql (Better Auth生成) が作るテーブルを参照する。

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
