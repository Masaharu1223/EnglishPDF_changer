// 使用量の上限や混み合いで断るときの 429 の応答。/api/process と /api/translations で共用する。

import { NextResponse } from "next/server";
import { BUSY_MESSAGE, limitMessage, nextResetAtIso, type UsageSubject } from "@/lib/usage";

// 引数: 上限に達した理由、使用量の対象、必要な文字数(分かるときだけ) / 返り値: 429 の応答(リセット時刻と Retry-After つき)
export function limitResponse(
  reason: "personal" | "pool",
  subject: UsageSubject,
  required?: number
): NextResponse {
  const resetAt = nextResetAtIso();
  const retryAfter = Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: limitMessage(subject, reason),
      reason,
      resetAt,
      ...(required === undefined ? {} : { required }),
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

// 引数: なし / 返り値: DB が混み合っているときの 429 の応答
export function busyResponse(): NextResponse {
  return NextResponse.json(
    { error: BUSY_MESSAGE, reason: "busy" },
    { status: 429, headers: { "Retry-After": "5" } }
  );
}
