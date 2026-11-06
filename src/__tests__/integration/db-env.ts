// DB統合テストの接続先(テスト用ブランチ)を決める補助モジュール。
// 本番と同じ接続先なら例外で中止し、本番DBを守る。

import { existsSync } from "node:fs";

export interface TestDb {
  ownerUrl: string;
  appUrl: string;
}

// 引数: DB接続URL / 返り値: ブランチごとのエンドポイントID(ホスト名の先頭から -pooler を除いたもの)
const endpointId = (url: string) => new URL(url).hostname.split(".")[0].replace(/-pooler$/, "");

// 引数: なし / 返り値: テスト用DBの接続先(所有者用とアプリ用)。未設定なら null
export function resolveTestDb(): TestDb | null {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const ownerUrl = process.env.DATABASE_URL_TEST_OWNER;
  const prodAppUrl = process.env.DATABASE_URL_APP;
  if (!ownerUrl || !prodAppUrl) return null;

  const prodUrls = [
    process.env.DATABASE_URL,
    process.env.DATABASE_URL_UNPOOLED,
    process.env.DATABASE_URL_APP,
  ].filter((u): u is string => !!u);
  if (prodUrls.some((u) => endpointId(u) === endpointId(ownerUrl))) {
    throw new Error(
      "DATABASE_URL_TEST_OWNER が本番と同じ接続先です。本番を壊さないため、テストを中止します。"
    );
  }

  const app = new URL(prodAppUrl);
  app.hostname = new URL(ownerUrl).hostname;
  return { ownerUrl, appUrl: app.toString() };
}
