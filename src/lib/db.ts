import { Pool } from "@neondatabase/serverless";

let pool: Pool | null = null;

// documents/sentences専用のPool。src/lib/auth.tsが持つPoolとは別インスタンス
// (DBは同じNeonプロジェクトだが、責務を分けて疎結合を保つ)。
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL_APP });
  }
  return pool;
}
