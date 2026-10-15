import { existsSync } from "node:fs";

// DB統合テストの接続先を決める。本番DBを壊さないための安全装置を兼ねる。
//  - DATABASE_URL_TEST_OWNER(テスト用ブランチの所有者ロール)が未設定なら、統合テストは飛ばす
//  - テスト用の接続先が、本番の接続先と同じなら、例外を投げて中止する
//  - アプリ用(app_user)の接続先は、本番の app_user の資格情報に、テスト用ブランチの
//    ホスト名を組み合わせて作る(ブランチは本番のロールとパスワードを引き継ぐため)。
//    .env.local を書き換えずに済む。

export interface TestDb {
  ownerUrl: string;
  appUrl: string;
}

// Neon の接続先は "ep-xxxx(-pooler).region.aws.neon.tech"。先頭が、ブランチごとのエンドポイントID
const endpointId = (url: string) => new URL(url).hostname.split(".")[0].replace(/-pooler$/, "");

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
