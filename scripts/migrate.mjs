// db/migrations/ 配下のSQLファイルを番号順に実行する。
// DATABASE_URL_UNPOOLED(所有者ロール)を使う。所有者ロールの接続文字列は
// Vercelには置かず、ローカルでのマイグレーション専用として扱う。
//
// 0003_roles_rls.sql の "__APP_USER_PASSWORD__" プレースホルダは、初回実行時に
// ランダム生成したパスワードへ置換し、生成した接続文字列を .env.local の
// DATABASE_URL_APP に書き込む(パスワードはファイル・標準出力のいずれにも残さない)。
//
// 冪等性は持たせていない(既に適用済みのファイルを再実行するとCREATE TABLE等で
// 失敗する)。個人開発規模の初回セットアップ用スクリプトのため、適用管理テーブルは
// 今回は作らない。

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";
// 実行時は `node --env-file=.env.local scripts/migrate.mjs` のように
// Node標準の --env-file で .env.local を読み込む(追加の依存関係は増やさない)

const envLocalPath = path.resolve(".env.local");
const migrationsDir = path.resolve("db/migrations");

const ownerUrl = process.env.DATABASE_URL_UNPOOLED;
if (!ownerUrl) {
  throw new Error("DATABASE_URL_UNPOOLED is not set in .env.local");
}

const appUserPassword = randomBytes(24).toString("base64url");

const pool = new Pool({ connectionString: ownerUrl });

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  let sql = readFileSync(path.join(migrationsDir, file), "utf8");
  if (sql.includes("__APP_USER_PASSWORD__")) {
    sql = sql.replaceAll("__APP_USER_PASSWORD__", appUserPassword);
  }
  console.log(`applying ${file} ...`);
  await pool.query(sql);
  console.log(`applied ${file}`);
}

// app_user用の接続文字列を、所有者ロールのURLからhost/dbを流用して組み立てる
const appUrlObj = new URL(ownerUrl);
appUrlObj.username = "app_user";
appUrlObj.password = appUserPassword;
const appUserUrl = appUrlObj.toString();

const envLocal = readFileSync(envLocalPath, "utf8");
const updated = envLocal.replace(
  /^DATABASE_URL_APP=.*$/m,
  `DATABASE_URL_APP=${appUserUrl}`
);
writeFileSync(envLocalPath, updated);

console.log("done. DATABASE_URL_APP updated in .env.local (value not printed).");
await pool.end();
