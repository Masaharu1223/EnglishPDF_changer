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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // Chunk-based flow: the client first requests the chunk list ("split"),
    // then translates each chunk one at a time ("translate"), updating the
    // UI as each result comes back. This replaces the old all-at-once
    // request so users see progress on long-form text instead of a single
    // spinner (see issue #10). The old all-at-once path (no `action`) was
    // removed: it ran every chunk through Claude inside a single request,
    // which a per-request usage limit cannot meter.
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

      // Reject oversized chunks before touching the usage table or Claude, so a
      // single request cannot bypass the per-day character limits.
      const { maxTranslateChunkChars, minChargeChars } = getUsageLimits();
      if (chunk.length > maxTranslateChunkChars) {
        return NextResponse.json(
          { error: `Chunk is too long (max ${maxTranslateChunkChars} characters)` },
          { status: 413 }
        );
      }

      // Reserve the usage *before* calling Claude: the check has to happen
      // where the money is spent, not in a separate client-side call.
      const session = await auth.api.getSession({ headers: request.headers });
      const subject = subjectFor(session, request.headers);
      // 短い chunk でも Claude の呼び出しには固定のコストがかかるので、最低課金分は予約する。
      const amount = Math.max(chunk.length, minChargeChars);
      const reserved = await reserveUsage(subject, "translate_chars", amount);
      if (!reserved.ok) {
        // busy は上限を超えたのではなく、DBが混み合って予約できなかっただけ。
        // リセット時刻は無関係なので返さず、数秒後の再試行を促す。
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

      // No `id` field here on purpose: the client assigns ids as it appends
      // each chunk's results to the running sentence list, so numbering
      // stays contiguous across chunks regardless of how many sentences
      // each chunk happens to produce.
      try {
        const sentences = await processChunk(chunk);
        return NextResponse.json({ sentences });
      } catch (error) {
        // Claude を呼べずに失敗したときだけ、予約した分を返す(何も消費していない)。
        // 応答を受け取ったあとの失敗は課金済みなので返さない。返すと、出力が途中で
        // 切れる入力を送り続けて、枠を減らさずに費用だけ発生させられてしまう。
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
