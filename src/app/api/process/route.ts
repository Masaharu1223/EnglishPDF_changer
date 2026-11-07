// 翻訳処理API。action が split なら本文をチャンクに分割し、translate なら1チャンクを翻訳する。
// translate では翻訳の前に使用量を予約し、上限を超える場合は429を返す。

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ClaudeResponseError, cleanText, processChunk, splitIntoChunks } from "@/lib/llm";
import { getUsageLimits } from "@/lib/usage-limits";
import {
  limitMessage,
  nextResetAtIso,
  refundUsage,
  reserveUsage,
  subjectFor,
} from "@/lib/usage";

// 引数: request(JSONで action と text または chunk を含む) / 返り値: チャンクの配列、または翻訳した例文のJSON
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "split") {
      const { text } = body;
      if (!text || typeof text !== "string") {
        return NextResponse.json({ error: "No text provided" }, { status: 400 });
      }
      const chunks = splitIntoChunks(cleanText(text));
      return NextResponse.json({ chunks });
    }

    if (action === "translate") {
      const { chunk } = body;
      if (!chunk || typeof chunk !== "string" || chunk.trim() === "") {
        return NextResponse.json({ error: "No chunk provided" }, { status: 400 });
      }

      const { maxTranslateChunkChars, minChargeChars } = getUsageLimits();
      if (chunk.length > maxTranslateChunkChars) {
        return NextResponse.json(
          { error: `Chunk is too long (max ${maxTranslateChunkChars} characters)` },
          { status: 413 }
        );
      }

      const session = await auth.api.getSession({ headers: request.headers });
      const subject = subjectFor(session, request.headers);
      const amount = Math.max(chunk.length, minChargeChars);
      const reserved = await reserveUsage(subject, "translate_chars", amount);
      if (!reserved.ok) {
        if (reserved.reason === "busy") {
          return NextResponse.json(
            { error: limitMessage(subject, "busy"), reason: "busy" },
            { status: 429, headers: { "Retry-After": "5" } }
          );
        }
        const resetAt = nextResetAtIso();
        const retryAfter = Math.max(
          1,
          Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000)
        );
        return NextResponse.json(
          {
            error: limitMessage(subject, reserved.reason),
            reason: reserved.reason,
            resetAt,
          },
          { status: 429, headers: { "Retry-After": String(retryAfter) } }
        );
      }

      try {
        const sentences = await processChunk(chunk);
        return NextResponse.json({ sentences });
      } catch (error) {
        if (!(error instanceof ClaudeResponseError)) {
          await refundUsage(reserved.reservation);
        }
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
