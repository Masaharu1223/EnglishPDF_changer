// 翻訳チケットを発行し、API の応答(JSON)にする。/api/extract と /api/process の split で共用する。

import { NextResponse } from "next/server";
import { startTranslation } from "@/lib/translation-ticket";
import { MAX_RAW_TEXT_CHARS } from "@/lib/document-limits";
import { cleanText, splitIntoChunks } from "@/lib/llm";
import type { SessionLike } from "@/lib/usage";

// 引数: 翻訳する本文、ログイン中のユーザー、リクエストヘッダー、応答に足す項目 / 返り値: チャンク・チケット・利用状況を含む応答(発行に失敗したら、チケットと利用状況は null)
export async function startTranslationResponse(
  text: string,
  user: SessionLike["user"],
  headers: Headers,
  extra: Record<string, unknown>
): Promise<NextResponse> {
  try {
    const result = await startTranslation(text, user, headers);
    if (!result.ok) {
      return NextResponse.json(
        { error: `テキストが長すぎます(最大 ${MAX_RAW_TEXT_CHARS.toLocaleString("ja-JP")} 文字)` },
        { status: 413 }
      );
    }
    const { chunks, ticket, usage } = result;
    return NextResponse.json({ ...extra, chunks, ticket, usage });
  } catch (error) {
    console.error("Failed to start translation with a ticket", error);
    return NextResponse.json({
      ...extra,
      chunks: splitIntoChunks(cleanText(text)),
      ticket: null,
      usage: null,
    });
  }
}
