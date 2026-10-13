import { createHmac } from "node:crypto";
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

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; reason: "personal" | "pool" };

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

  const buckets = bucketsFor(subject, getUsageLimits()).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  );

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
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
    throw error;
  } finally {
    client.release();
  }
}

// 外部APIの呼び出しが失敗したときに、予約した分を戻す。予約した日(UTC)の行に対して戻すので、
// 日付をまたいでも別の日の使用量を減らさない。返却の失敗は、元のエラーの処理を邪魔しないよう
// ログに残すだけにする(戻せなかった分は、その日の枠が少し余計に減るだけ)。
export async function refundUsage(reservation: Reservation): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
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
      await client.query("ROLLBACK");
    } catch {
      // 無視する
    }
    console.error("Failed to refund usage", error);
  } finally {
    client.release();
  }
}
