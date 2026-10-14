import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isFeatureAllowed } from "@/lib/access";
import { generateSpeech } from "@/lib/elevenlabs";

export async function POST(request: NextRequest) {
  try {
    // 音声合成は ElevenLabs の費用がかかるうえ、利用回数の制限をまだ持たないため、
    // 試験導入として許可リストのアカウントだけに限定している(FEATURE_ALLOWED_EMAILS)。
    // 画面でボタンを隠すだけでは curl などで直接叩けるので、判定はここ(外部APIを呼ぶ直前)で行う。
    // 公開するときは、この判定の条件を変えるだけでよい。
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json(
        { error: "Login required", reason: "login_required" },
        { status: 401 }
      );
    }
    if (!isFeatureAllowed(session.user)) {
      return NextResponse.json(
        { error: "This feature is currently limited to approved accounts.", reason: "not_allowed" },
        { status: 403 }
      );
    }

    const { text } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const audioUrl = await generateSpeech(text);
    return NextResponse.json({ audioUrl });
  } catch (error) {
    console.error("TTS error:", error);
    return NextResponse.json(
      { error: "Failed to generate audio." },
      { status: 500 }
    );
  }
}
