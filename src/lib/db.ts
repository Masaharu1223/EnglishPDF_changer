// documents/sentences 用の Postgres 接続プール(Neon)を、1つだけ作って使い回す。
// auth.ts の Pool とは別インスタンスにしている。

import { Pool } from "@neondatabase/serverless";

let pool: Pool | null = null;

// 引数: なし / 返り値: 共有の Pool(初回の呼び出しで作る)
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL_APP });
  }
  return pool;
}
