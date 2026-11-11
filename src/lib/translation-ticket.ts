// 翻訳1件ごとのチケットの発行・翻訳での使用・返金・保存での使用済み化を行う(Issue #54)。
// チケットを持っている間は、セッションが切れていても、発行時のユーザーとして翻訳と保存ができる。

import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { getPool } from "@/lib/db";
import { MAX_RAW_TEXT_CHARS } from "@/lib/document-limits";
import { cleanText, splitIntoChunks } from "@/lib/llm";
import { getUsageLimits } from "@/lib/usage-limits";
import { buildUsageInfo } from "@/lib/usage-info";
import {
  beginWithLockTimeout,
  isBusyError,
  refundUsageInTransaction,
  reserveUsageInTransaction,
  subjectFor,
  type Reservation,
  type SessionLike,
  type UsageSubject,
} from "@/lib/usage";
import type { UsageInfo } from "@/types";

export const TICKET_HEADER = "x-translation-ticket";
export const TICKET_INVALID_BODY = {
  error: "翻訳の受付が無効になりました(期限切れか、すでに使われています)。もう一度、最初から翻訳してください。",
  reason: "ticket_invalid",
} as const;
const TICKET_LIFETIME_HOURS = 24;
const MAX_ACTIVE_TICKETS_PER_USER = 10;

// 引数: 文字列 / 返り値: SHA-256 の16進文字列
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// 引数: チャンクの配列、1回の翻訳の最低課金文字数 / 返り値: チケットで翻訳できる文字数の合計
export function budgetFor(chunks: string[], minChargeChars: number): number {
  return chunks.reduce((sum, chunk) => sum + Math.max(chunk.length, minChargeChars), 0);
}

export type StartTranslationResult =
  | { ok: true; chunks: string[]; usage: UsageInfo; ticket: string | null }
  | { ok: false; reason: "too_long" };

type TicketSubject = Exclude<UsageSubject, { type: "anon" }>;

// 引数: ユーザーID / 返り値: なし(使えなくなった行を消し、使える行を最新の数枚に絞る)
async function pruneTickets(userId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `DELETE FROM translation_tickets
      WHERE user_id = $1 AND (expires_at <= now() OR consumed_at IS NOT NULL)`,
    [userId]
  );
  await pool.query(
    `DELETE FROM translation_tickets
      WHERE id IN (
        SELECT id FROM translation_tickets
         WHERE user_id = $1
         ORDER BY created_at DESC, id DESC
        OFFSET $2
      )`,
    [userId, MAX_ACTIVE_TICKETS_PER_USER - 1]
  );
}

// 引数: 翻訳する本文、ログイン中のユーザー、リクエストヘッダー / 返り値: チャンク・利用状況・チケット(残量が足りなければチケットは null)
export async function startTranslation(
  text: string,
  user: SessionLike["user"],
  headers: Headers
): Promise<StartTranslationResult> {
  if (text.length > MAX_RAW_TEXT_CHARS) return { ok: false, reason: "too_long" };

  const chunks = splitIntoChunks(cleanText(text));
  const subject = subjectFor({ user }, headers);
  if (subject.type === "anon") throw new Error("startTranslation requires a logged-in user");

  const usage = await buildUsageInfo(user, subject);
  const budget = budgetFor(chunks, getUsageLimits().minChargeChars);
  if (chunks.length === 0 || budget > usage.translate.remaining) {
    return { ok: true, chunks, usage, ticket: null };
  }

  const ticket = randomBytes(32).toString("base64url");
  await pruneTickets(subject.userId);
  await getPool().query(
    `INSERT INTO translation_tickets
       (token_hash, user_id, subject_type, budget_chars, raw_text_hash, chunk_hashes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7))`,
    [
      sha256Hex(ticket),
      subject.userId,
      subject.type,
      budget,
      sha256Hex(text),
      chunks.map(sha256Hex),
      TICKET_LIFETIME_HOURS,
    ]
  );
  return { ok: true, chunks, usage, ticket };
}

export interface TicketReservation {
  tokenHash: string;
  subject: TicketSubject;
  reservation: Reservation;
}

export type ReserveWithTicketResult =
  | ({ ok: true } & TicketReservation)
  | { ok: false; reason: "personal" | "pool"; subject: TicketSubject }
  | { ok: false; reason: "busy" }
  | { ok: false; reason: "ticket_invalid" };

// 引数: 開始済みのトランザクション、チケットのハッシュ、チャンク、使う文字数 / 返り値: チケットの持ち主(使えないチケットなら null)
async function chargeTicketChars(
  client: PoolClient,
  tokenHash: string,
  chunk: string,
  amount: number
): Promise<TicketSubject | null> {
  const result = await client.query<{ user_id: string; subject_type: "owner" | "user" }>(
    `UPDATE translation_tickets
        SET used_chars = used_chars + $2
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > now()
        AND $3 = ANY(chunk_hashes)
        AND used_chars + $2 <= budget_chars
      RETURNING user_id, subject_type`,
    [tokenHash, amount, sha256Hex(chunk)]
  );
  const row = result.rows[0];
  return row ? { type: row.subject_type, userId: row.user_id } : null;
}

// 引数: チケットのハッシュ / 返り値: なし(使用済みにする。失敗してもログに残すだけ)
async function consumeTicketQuietly(client: PoolClient, tokenHash: string): Promise<void> {
  try {
    await client.query(
      "UPDATE translation_tickets SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL",
      [tokenHash]
    );
  } catch (error) {
    console.error("Failed to consume ticket", error);
  }
}

// 引数: チケット、翻訳するチャンク / 返り値: 予約の成否(チケットの確認・使用文字数の加算・使用量の予約を1トランザクションで行う)
export async function reserveWithTicket(
  ticket: string,
  chunk: string
): Promise<ReserveWithTicketResult> {
  const limits = getUsageLimits();
  const amount = Math.max(chunk.length, limits.minChargeChars);
  const tokenHash = sha256Hex(ticket);

  const client = await getPool().connect();
  try {
    await client.query(beginWithLockTimeout(limits.lockTimeoutMs));
    const subject = await chargeTicketChars(client, tokenHash, chunk, amount);
    if (!subject) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "ticket_invalid" };
    }

    const reserved = await reserveUsageInTransaction(client, subject, "translate_chars", amount);
    if (!reserved.ok) {
      await client.query("ROLLBACK");
      await consumeTicketQuietly(client, tokenHash);
      return { ok: false, reason: reserved.reason, subject };
    }

    await client.query("COMMIT");
    return { ok: true, tokenHash, subject, reservation: reserved.reservation };
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

// 引数: チケットでの予約 / 返り値: なし(使用量とチケットの使用文字数を戻す。失敗してもログに残すだけ)
export async function refundWithTicket({ tokenHash, reservation }: TicketReservation): Promise<void> {
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query(beginWithLockTimeout(getUsageLimits().lockTimeoutMs));
    await client.query(
      `UPDATE translation_tickets
          SET used_chars = GREATEST(used_chars - $2, 0)
        WHERE token_hash = $1`,
      [tokenHash, reservation.amount]
    );
    await refundUsageInTransaction(client, reservation);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client?.query("ROLLBACK");
    } catch {
    }
    console.error("Failed to refund ticket usage", error);
  } finally {
    client?.release();
  }
}

// 引数: 開始済みのトランザクション、チケット、保存する本文 / 返り値: チケットの持ち主のユーザーID(使えないチケットなら null)
export async function consumeTicketForSave(
  client: PoolClient,
  ticket: string,
  rawText: string
): Promise<string | null> {
  const result = await client.query<{ user_id: string }>(
    `UPDATE translation_tickets
        SET consumed_at = now()
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > now()
        AND raw_text_hash = $2
      RETURNING user_id`,
    [sha256Hex(ticket), sha256Hex(rawText)]
  );
  return result.rows[0]?.user_id ?? null;
}
