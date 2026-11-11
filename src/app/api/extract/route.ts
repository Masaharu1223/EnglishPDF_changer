// テキスト抽出API。アップロードされたPDF/TXT(base64)から本文テキストを取り出して返す。
// withTicket が送られ、ログイン中なら、分割と翻訳チケットの発行まで行う(抽出の前にログインを確認する)。

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { extractTextFromPDF, extractTextFromTXT } from "@/lib/pdf-parser";
import { startTranslationResponse } from "@/lib/translation-ticket-response";

// 引数: request(JSONで fileName と fileData、任意で withTicket を含む) / 返り値: 抽出したテキスト(とチャンク・チケット・利用状況)のJSON
export async function POST(request: NextRequest) {
  try {
    const { fileName, fileData, withTicket } = await request.json();

    if (!fileName || !fileData) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const session =
      withTicket === true ? await auth.api.getSession({ headers: request.headers }) : null;

    const buffer = Buffer.from(fileData, "base64");
    const name = fileName.toLowerCase();
    let text: string;

    if (name.endsWith(".pdf")) {
      text = await extractTextFromPDF(buffer);
    } else if (name.endsWith(".txt")) {
      text = extractTextFromTXT(buffer);
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a PDF or TXT file." },
        { status: 400 }
      );
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "No text could be extracted from the file." },
        { status: 400 }
      );
    }

    if (session?.user) {
      return await startTranslationResponse(text, session.user, request.headers, { text, fileName });
    }
    return NextResponse.json({ text, fileName });
  } catch (error) {
    console.error("Extract error:", error);
    return NextResponse.json(
      { error: "Failed to extract text from file." },
      { status: 500 }
    );
  }
}
