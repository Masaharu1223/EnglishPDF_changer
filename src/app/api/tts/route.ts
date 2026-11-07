// 音声合成API。許可されたログイン済みアカウントに限り、テキストを音声に変換してURLを返す。

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isFeatureAllowed } from "@/lib/access";
import { generateSpeech } from "@/lib/elevenlabs";

const MAX_TTS_CHARS = 5_000;

// 引数: request(JSONで text を含む) / 返り値: 音声のURL(audioUrl)のJSON
export async function POST(request: NextRequest) {
  try {
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

    if (text.length > MAX_TTS_CHARS) {
      return NextResponse.json(
        { error: `Text is too long (max ${MAX_TTS_CHARS} characters)` },
        { status: 413 }
      );
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
