import { createHmac } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { getPool } from "@/lib/db";
import { isFeatureAllowed } from "@/lib/access";
import { getClientIp } from "@/lib/client-ip";
import { getUsageLimits, type UsageLimits } from "@/lib/usage-limits";

// 外部の有料APIを呼ぶ「前に」使用量を予約し、上限を超えるなら断る。
// 使用量は Neon の usage テーブルに置く(サーバーレスはメモリを共有しないため)。

export type UsageKind = "translate_chars";

// 誰の使用量として数えるか。
//  owner: 許可リストのアカウント(自分)。全体の予算には数えず、別枠の安全装置だけ
//  user:  ログイン済みの自分以外のユーザー
//  anon:  未ログイン
export type UsageSubject =
  | { type: "owner"; userId: string }
  | { type: "user"; userId: string }
  | { type: "anon"; ip: string };

interface SessionLike {
  user: { id: string; email?: string | null; emailVerified?: boolean | null };
}

export function subjectFor(session: SessionLike | null, headers: Headers): UsageSubject {
  if (session?.user?.id) {
    return isFeatureAllowed(session.user)
      ? { type: "owner", userId: session.user.id }
      : { type: "user", userId: session.user.id };
  }
  return { type: "anon", ip: getClientIp(headers) };
}

// 生のIPアドレスは保存しない。鍵付きのハッシュにして、DBが漏れても元のIPを復元できないようにする。
// 鍵は既存の BETTER_AUTH_SECRET を流用する(新しいシークレットを増やさないため)。
function hashIp(ip: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`usage-ip:${ip}`).digest("hex").slice(0, 32);
}

interface Bucket {
  key: string;
  limit: number;
}

// 1回の予約で、個人の枠と全体の枠をまとめて確認する。
//   'u:<id>'    ログイン済みの個人    'ip:<hash>' 未ログインのIP
//   'anon:*'    未ログイン全体        'others:*'  自分以外の全員の合計(予算の天井)
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

// 個人の枠を超えた(personal)か、全体の枠を超えた(pool)かで、画面に出す案内を変える。
function reasonFor(key: string): "personal" | "pool" {
  return key.startsWith("u:") || key.startsWith("ip:") ? "personal" : "pool";
}

// INSERT ... SELECT ... WHERE にしているのは、ON CONFLICT ... WHERE が更新側にしか
// 効かず、新しいキーの1回目が上限を超えても通ってしまうため(本番DBでのドライランで確認済み)。
// 条件を満たさないときは0行が返る。日付はUTC(トランザクション内の now() は一定なので、
// 同じ予約の全バケットで同じ日になる)。
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

// busy: 他のリクエストのロックを待ち切れなかった(または、デッドロックとして取り消された)。
// 上限を超えたわけではないので、少し待って、もう一度試せばよい。
export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; reason: "personal" | "pool" | "busy" };

// Postgres のエラーコード: 55P03 = ロックの待ち時間切れ、40P01 = デッドロックで取り消し
function isBusyError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "55P03" || code === "40P01";
}

// SET LOCAL は、パラメータ($1)を取れないので、検証済みの整数をそのまま埋め込む。
// BEGIN と同じ1回の通信で送るので、往復は増えない(このトランザクションの中だけで有効)。
function beginWithLockTimeout(lockTimeoutMs: number): string {
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs <= 0) {
    throw new Error("lockTimeoutMs must be a positive integer");
  }
  return `BEGIN; SET LOCAL lock_timeout = ${lockTimeoutMs}`;
}

// 全バケットを1つのトランザクションで予約する。どれか1つでも上限を超えたら全体を
// ロールバックし、片方だけ消費されることがない。同時リクエストがお互いを待ち合って
// デッドロックしないよう、キーの順に処理する。
export async function reserveUsage(
  subject: UsageSubject,
  kind: UsageKind,
  amount: number
): Promise<ReserveResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("amount must be a positive integer");
  }

  const limits = getUsageLimits();
  const buckets = bucketsFor(subject, limits).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  );

  const client = await getPool().connect();
  try {
    await client.query(beginWithLockTimeout(limits.lockTimeoutMs));
    let day = "";
    for (const bucket of buckets) {
      const res = await client.query(RESERVE_SQL, [bucket.key, kind, amount, bucket.limit]);
      if (res.rows.length === 0) {
        await client.query("ROLLBACK");
        return { ok: false, reason: reasonFor(bucket.key) };
      }
      day = res.rows[0].day as string;
    }
    await client.query("COMMIT");
    return { ok: true, reservation: { keys: buckets.map((b) => b.key), day, kind, amount } };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // 接続が既に切れている場合は無視する(元のエラーを優先する)
    }
    // 待ち時間切れ・デッドロックは、予約できなかっただけ。例外にせず「混み合っている」と返す
    if (isBusyError(error)) return { ok: false, reason: "busy" };
    throw error;
  } finally {
    client.release();
  }
}

// 外部APIの呼び出しが失敗したときに、予約した分を戻す。予約した日(UTC)の行に対して戻すので、
// 日付をまたいでも別の日の使用量を減らさない。返却の失敗は、元のエラーの処理を邪魔しないよう
// ログに残すだけにする(戻せなかった分は、その日の枠が少し余計に減るだけ)。
export async function refundUsage(reservation: Reservation): Promise<void> {
  // 接続の取得も含めて、例外処理の中に入れる(DBに繋がらないときも、元の処理を邪魔しない)
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query(beginWithLockTimeout(getUsageLimits().lockTimeoutMs));
    for (const key of [...reservation.keys].sort()) {
      await client.query(
        `UPDATE usage
           SET amount = GREATEST(amount - $4::int, 0), updated_at = now()
         WHERE subject_key = $1::text AND day = $2::date AND kind = $3::text`,
        [key, reservation.day, reservation.kind, reservation.amount]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client?.query("ROLLBACK");
    } catch {
      // 無視する
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

// 今日あと何文字使えるかを読み取る(予約はしない。画面に表示するためだけの値で、
// 実際の判定は reserveUsage がサーバー側で行う)。個人の枠と全体の枠のうち、
// 残りが最も小さいものを返す。
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
  return {
    remaining: min.remaining,
    limit: buckets[0].limit, // 先頭は常に個人の枠
    constrainedBy: reasonFor(min.key),
  };
}

// 使用量は UTC の日付ごとに数えるので、次のUTC 0時(日本時間の9時)にリセットされる。
// API間のやりとりは ISO 8601 で返す(日付・時刻の規約)。
export function nextResetAtIso(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString();
}

// 上限を超えたときに画面へ出す案内。UIでは時刻のタイムゾーンを必ず明示する。
export function limitMessage(
  subject: UsageSubject,
  reason: "personal" | "pool" | "busy"
): string {
  if (reason === "busy") {
    return "現在、アクセスが集中しています。少し時間をおいて、もう一度お試しください。";
  }
  const reset = "毎日 9:00(JST)にリセットされます。";
  if (reason === "pool") {
    return `現在、ご利用が集中しているため、全体の利用上限に達しました。上限は${reset}`;
  }
  if (subject.type === "anon") {
    return `未ログインで使える本日の上限に達しました。ログインすると、より多く使えます。上限は${reset}`;
  }
  return `本日の利用上限に達しました。上限は${reset}`;
}
