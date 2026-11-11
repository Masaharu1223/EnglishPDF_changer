// 使用量取得API。今日の残り翻訳文字数と、利用できる機能(音声)を返す読み取り専用のAPI。

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { subjectFor } from "@/lib/usage";
import { buildUsageInfo } from "@/lib/usage-info";

export const dynamic = "force-dynamic";

// 引数: request(リクエスト) / 返り値: 使用量の情報(UsageInfo)のJSON
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const body = await buildUsageInfo(session?.user ?? null, subjectFor(session, request.headers));
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Usage error:", error);
    return NextResponse.json({ error: "Failed to load usage." }, { status: 500 });
  }
}
