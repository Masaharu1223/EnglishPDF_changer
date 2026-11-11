// 翻訳処理API。action が split なら本文をチャンクに分割し、translate なら1チャンクを翻訳する。
// translate では翻訳の前に使用量を予約し、上限を超える場合は429を返す。
// 翻訳チケットが付いていれば、セッションの代わりにチケットの持ち主として予約する。

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ClaudeResponseError, cleanText, processChunk, splitIntoChunks } from "@/lib/llm";
import { getUsageLimits } from "@/lib/usage-limits";
import {
  BUSY_MESSAGE,
  limitMessage,
  nextResetAtIso,
  refundUsage,
  reserveUsage,
  subjectFor,
  type UsageSubject,
} from "@/lib/usage";
import {
  TICKET_HEADER,
  TICKET_INVALID_BODY,
  refundWithTicket,
  reserveWithTicket,
} from "@/lib/translation-ticket";
import { startTranslationResponse } from "@/lib/translation-ticket-response";

type ChunkReservation =
  | { ok: true; refund: () => Promise<void> }
  | { ok: false; response: NextResponse };

// 引数: 上限に達した理由、使用量の対象 / 返り値: 429 の応答(リセット時刻と Retry-After つき)
function limitResponse(reason: "personal" | "pool", subject: UsageSubject): NextResponse {
  const resetAt = nextResetAtIso();
  const retryAfter = Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000));
  return NextResponse.json(
    { error: limitMessage(subject, reason), reason, resetAt },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

// 引数: なし / 返り値: DB が混み合っているときの 429 の応答
function busyResponse(): NextResponse {
  return NextResponse.json(
    { error: BUSY_MESSAGE, reason: "busy" },
    { status: 429, headers: { "Retry-After": "5" } }
  );
}

// 引数: request(リクエスト)、翻訳するチャンク / 返り値: 予約の成否(成功なら返金の関数、失敗なら返す応答)
async function reserveForChunk(request: NextRequest, chunk: string): Promise<ChunkReservation> {
  const ticket = request.headers.get(TICKET_HEADER);
  if (ticket !== null) {
    const reserved = await reserveWithTicket(ticket, chunk);
    if (reserved.ok) return { ok: true, refund: () => refundWithTicket(reserved) };
    if (reserved.reason === "ticket_invalid") {
      return { ok: false, response: NextResponse.json(TICKET_INVALID_BODY, { status: 401 }) };
    }
    if (reserved.reason === "busy") return { ok: false, response: busyResponse() };
    return { ok: false, response: limitResponse(reserved.reason, reserved.subject) };
  }

  const session = await auth.api.getSession({ headers: request.headers });
  const subject = subjectFor(session, request.headers);
  const amount = Math.max(chunk.length, getUsageLimits().minChargeChars);
  const reserved = await reserveUsage(subject, "translate_chars", amount);
  if (reserved.ok) return { ok: true, refund: () => refundUsage(reserved.reservation) };
  if (reserved.reason === "busy") return { ok: false, response: busyResponse() };
  return { ok: false, response: limitResponse(reserved.reason, subject) };
}

// 引数: request(JSONで action と text または chunk を含む) / 返り値: チャンクの配列、または翻訳した例文のJSON
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "split") {
      const { text, withTicket } = body;
      if (!text || typeof text !== "string") {
        return NextResponse.json({ error: "No text provided" }, { status: 400 });
      }
      if (withTicket === true) {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session?.user) {
          return await startTranslationResponse(text, session.user, request.headers, {});
        }
      }
      const chunks = splitIntoChunks(cleanText(text));
      return NextResponse.json({ chunks });
    }

    if (action === "translate") {
      const { chunk } = body;
      if (!chunk || typeof chunk !== "string" || chunk.trim() === "") {
        return NextResponse.json({ error: "No chunk provided" }, { status: 400 });
      }

      const { maxTranslateChunkChars } = getUsageLimits();
      if (chunk.length > maxTranslateChunkChars) {
        return NextResponse.json(
          { error: `Chunk is too long (max ${maxTranslateChunkChars} characters)` },
          { status: 413 }
        );
      }

      const reserved = await reserveForChunk(request, chunk);
      if (!reserved.ok) return reserved.response;

      try {
        const sentences = await processChunk(chunk);
        return NextResponse.json({ sentences });
      } catch (error) {
        if (!(error instanceof ClaudeResponseError)) await reserved.refund();
        throw error;
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Process error:", error);
    return NextResponse.json(
      { error: "Failed to process text with Claude." },
      { status: 500 }
    );
  }
}
