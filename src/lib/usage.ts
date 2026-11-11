// 外部の有料APIを呼ぶ前に、使用量を DB(usage テーブル)へ予約して上限を超えるなら断る。
// 予約の取り消し、残量の取得、リセット時刻、案内文もここにある。

import { createHmac } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { getPool } from "@/lib/db";
import { isFeatureAllowed } from "@/lib/access";
import { getClientIp } from "@/lib/client-ip";
import { getUsageLimits, type UsageLimits } from "@/lib/usage-limits";

export type UsageKind = "translate_chars";

export type UsageSubject =
  | { type: "owner"; userId: string }
  | { type: "user"; userId: string }
  | { type: "anon"; ip: string };

export interface SessionLike {
  user: { id: string; email?: string | null; emailVerified?: boolean | null };
}

// 引数: セッション(未ログインなら null)、リクエストヘッダー / 返り値: 使用量を数える対象
export function subjectFor(session: SessionLike | null, headers: Headers): UsageSubject {
  if (session?.user?.id) {
    return isFeatureAllowed(session.user)
      ? { type: "owner", userId: session.user.id }
      : { type: "user", userId: session.user.id };
  }
  return { type: "anon", ip: getClientIp(headers) };
}

// 引数: IPアドレス / 返り値: 鍵付きハッシュ(先頭32文字)
function hashIp(ip: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`usage-ip:${ip}`).digest("hex").slice(0, 32);
}

interface Bucket {
  key: string;
  limit: number;
}

// 引数: 使用量の対象、上限値一式 / 返り値: 確認する枠(キーと上限)の配列
export function bucketsFor(subject: UsageSubject, limits: UsageLimits): Bucket[] {
  switch (subject.type) {
    case "owner":
      return [{ key: `u:${subject.userId}`, limit: limits.ownerChars }];
    case "user":
      return [
        { key: `u:${subject.userId}`, limit: limits.userChars },
        { key: "others:*", limit: limits.othersTotalChars },
      ];
    case "anon":
      return [
        { key: `ip:${hashIp(subject.ip)}`, limit: limits.anonIpChars },
        { key: "anon:*", limit: limits.anonTotalChars },
        { key: "others:*", limit: limits.othersTotalChars },
      ];
  }
}

// 引数: 枠のキー / 返り値: 個人の枠なら "personal"、全体の枠なら "pool"
function reasonFor(key: string): "personal" | "pool" {
  return key.startsWith("u:") || key.startsWith("ip:") ? "personal" : "pool";
}

const RESERVE_SQL = `
  INSERT INTO usage (subject_key, day, kind, amount)
  SELECT $1::text, (now() AT TIME ZONE 'utc')::date, $2::text, $3::int
  WHERE $3::int <= $4::int
  ON CONFLICT (subject_key, day, kind)
  DO UPDATE SET amount = usage.amount + $3::int, updated_at = now()
  WHERE usage.amount + $3::int <= $4::int
  RETURNING day::text AS day`;

export interface Reservation {
  keys: string[];
  day: string;
  kind: UsageKind;
  amount: number;
}

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; reason: "personal" | "pool" | "busy" };

// 引数: 捕まえたエラー / 返り値: ロック待ち切れまたはデッドロックによる失敗かの真偽値
export function isBusyError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "55P03" || code === "40P01";
}

// 引数: ロック待ちの最大時間(ミリ秒) / 返り値: ロック待ち時間を設定する BEGIN のSQL文
export function beginWithLockTimeout(lockTimeoutMs: number): string {
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs <= 0) {
    throw new Error("lockTimeoutMs must be a positive integer");
  }
  return `BEGIN; SET LOCAL lock_timeout = ${lockTimeoutMs}`;
}

// 引数: 開始済みのトランザクション、使用量の対象、種類、予約する量 / 返り値: 予約の成否(失敗時は呼び出し側が ROLLBACK する)
export async function reserveUsageInTransaction(
  client: PoolClient,
  subject: UsageSubject,
  kind: UsageKind,
  amount: number
): Promise<{ ok: true; reservation: Reservation } | { ok: false; reason: "personal" | "pool" }> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("amount must be a positive integer");
  }

  const buckets = bucketsFor(subject, getUsageLimits()).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  );
  let day = "";
  for (const bucket of buckets) {
    const res = await client.query(RESERVE_SQL, [bucket.key, kind, amount, bucket.limit]);
    if (res.rows.length === 0) return { ok: false, reason: reasonFor(bucket.key) };
    day = res.rows[0].day as string;
  }
  return { ok: true, reservation: { keys: buckets.map((b) => b.key), day, kind, amount } };
}

// 引数: 使用量の対象、使用量の種類、予約する量 / 返り値: 予約の成否(成功なら予約情報、失敗なら理由)
export async function reserveUsage(
  subject: UsageSubject,
  kind: UsageKind,
  amount: number
): Promise<ReserveResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("amount must be a positive integer");
  }

  const client = await getPool().connect();
  try {
    await client.query(beginWithLockTimeout(getUsageLimits().lockTimeoutMs));
    const result = await reserveUsageInTransaction(client, subject, kind, amount);
    await client.query(result.ok ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
    }
    if (isBusyError(error)) return { ok: false, reason: "busy" };
    throw error;
  } finally {
    client.release();
  }
}

// 引数: 開始済みのトランザクション、予約情報 / 返り値: なし(予約した分を使用量から戻す)
export async function refundUsageInTransaction(
  client: PoolClient,
  reservation: Reservation
): Promise<void> {
  for (const key of [...reservation.keys].sort()) {
    await client.query(
      `UPDATE usage
         SET amount = GREATEST(amount - $4::int, 0), updated_at = now()
       WHERE subject_key = $1::text AND day = $2::date AND kind = $3::text`,
      [key, reservation.day, reservation.kind, reservation.amount]
    );
  }
}

// 引数: 予約情報 / 返り値: なし(予約した分を使用量から戻す。失敗してもログに残すだけ)
export async function refundUsage(reservation: Reservation): Promise<void> {
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query(beginWithLockTimeout(getUsageLimits().lockTimeoutMs));
    await refundUsageInTransaction(client, reservation);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client?.query("ROLLBACK");
    } catch {
    }
    console.error("Failed to refund usage", error);
  } finally {
    client?.release();
  }
}

export interface RemainingUsage {
  remaining: number;
  limit: number;
  constrainedBy: "personal" | "pool";
}

// 引数: 使用量の対象、使用量の種類 / 返り値: 今日の残り文字数と、残りを決めた枠の種類
export async function getRemainingUsage(
  subject: UsageSubject,
  kind: UsageKind
): Promise<RemainingUsage> {
  const buckets = bucketsFor(subject, getUsageLimits());
  const res = await getPool().query(
    `SELECT subject_key, amount FROM usage
      WHERE subject_key = ANY($1::text[])
        AND day = (now() AT TIME ZONE 'utc')::date
        AND kind = $2::text`,
    [buckets.map((b) => b.key), kind]
  );
  const used = new Map<string, number>(
    res.rows.map((r) => [r.subject_key as string, r.amount as number])
  );

  let min = { remaining: Infinity, key: buckets[0].key };
  for (const b of buckets) {
    const remaining = Math.max(b.limit - (used.get(b.key) ?? 0), 0);
    if (remaining < min.remaining) min = { remaining, key: b.key };
  }
  const personalBucket = buckets[0];
  return {
    remaining: min.remaining,
    limit: personalBucket.limit,
    constrainedBy: reasonFor(min.key),
  };
}

// 引数: 基準の日時(省略時は現在) / 返り値: 次のUTC 0時(ISO 8601形式)
export function nextResetAtIso(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString();
}

export const BUSY_MESSAGE =
  "現在、アクセスが集中しています。少し時間をおいて、もう一度お試しください。";

// 引数: 使用量の対象、上限を超えた理由 / 返り値: 画面に出す案内文
export function limitMessage(
  subject: UsageSubject,
  reason: "personal" | "pool" | "busy"
): string {
  if (reason === "busy") return BUSY_MESSAGE;
  const reset = "毎日 9:00(JST)にリセットされます。";
  if (reason === "pool") {
    return `現在、ご利用が集中しているため、全体の利用上限に達しました。上限は${reset}`;
  }
  if (subject.type === "anon") {
    return `未ログインで使える本日の上限に達しました。ログインすると、より多く使えます。上限は${reset}`;
  }
  return `本日の利用上限に達しました。上限は${reset}`;
}
