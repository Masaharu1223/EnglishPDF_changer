import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isFeatureAllowed } from "@/lib/access";
import { getUsageLimits } from "@/lib/usage-limits";
import { getRemainingUsage, nextResetAtIso, subjectFor } from "@/lib/usage";
import type { UsageInfo } from "@/types";

// リクエストごとにセッションと使用量を読むので、ビルド時に静的に評価させない。
export const dynamic = "force-dynamic";

// 画面に「今日の残り」を出し、音声などの機能を出し分けるための読み取り専用API。
// 使用量の予約はしない。ここで「使える」と返しても、実際の判定は各APIルートが
// 外部APIを呼ぶ直前に行う(この値を信用して判定を省かない)。
// 許可リストのメールアドレスそのものは返さず、「使えるかどうか」だけを返す。
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const subject = subjectFor(session, request.headers);
    const translate = await getRemainingUsage(subject, "translate_chars");

    const body: UsageInfo = {
      loggedIn: !!session?.user,
      capabilities: { tts: isFeatureAllowed(session?.user) },
      translate: {
        ...translate,
        minCharge: getUsageLimits().minChargeChars,
        resetAt: nextResetAtIso(),
      },
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Usage error:", error);
    return NextResponse.json({ error: "Failed to load usage." }, { status: 500 });
  }
}
