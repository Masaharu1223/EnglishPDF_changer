// 履歴保存API。ログイン中のユーザーの教材(タイトル・元テキスト・例文)を検証してDBに保存する。
// 翻訳チケットが付いていれば、セッションの代わりにチケットの持ち主として保存する。

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  saveDocument,
  saveDocumentWithTicket,
  type SaveDocumentInput,
  type SaveDocumentSentence,
} from "@/lib/documents";
import {
  MAX_ORIGINAL_CHARS,
  MAX_RAW_TEXT_CHARS,
  MAX_SENTENCES,
  MAX_TITLE_CHARS,
  MAX_TRANSLATION_CHARS,
} from "@/lib/document-limits";
import { TICKET_HEADER, TICKET_INVALID_BODY } from "@/lib/translation-ticket";

const SOURCE_TYPES = ["pdf", "txt", "paste"] as const;

// 引数: value(検証する値) / 返り値: 保存用の例文として正しい形かどうか(真偽値)
function isValidSentence(value: unknown): value is SaveDocumentSentence {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.position === "number" &&
    typeof s.original === "string" &&
    s.original.length <= MAX_ORIGINAL_CHARS &&
    typeof s.translation === "string" &&
    s.translation.length <= MAX_TRANSLATION_CHARS
  );
}

// 引数: リクエストの本文 / 返り値: 保存する内容(ユーザーID以外)、または400のエラー応答
function parseDocument(
  body: Record<string, unknown>
): Omit<SaveDocumentInput, "userId"> | NextResponse {
  const { title, sourceType, rawText, sentences } = body;
  if (typeof title !== "string" || title.length < 1 || title.length > MAX_TITLE_CHARS) {
    return NextResponse.json({ error: "Invalid title" }, { status: 400 });
  }
  if (!SOURCE_TYPES.includes(sourceType as (typeof SOURCE_TYPES)[number])) {
    return NextResponse.json({ error: "Invalid sourceType" }, { status: 400 });
  }
  if (typeof rawText !== "string" || rawText.length < 1 || rawText.length > MAX_RAW_TEXT_CHARS) {
    return NextResponse.json({ error: "Invalid rawText" }, { status: 400 });
  }
  if (
    !Array.isArray(sentences) ||
    sentences.length === 0 ||
    sentences.length > MAX_SENTENCES ||
    !sentences.every(isValidSentence)
  ) {
    return NextResponse.json({ error: "Invalid sentences" }, { status: 400 });
  }
  return {
    title,
    sourceType: sourceType as SaveDocumentInput["sourceType"],
    rawText,
    sentences,
  };
}

// 引数: request(JSONで title, sourceType, rawText, sentences を含む) / 返り値: 保存した教材の id のJSON
export async function POST(request: NextRequest) {
  const ticket = request.headers.get(TICKET_HEADER);
  let save: (doc: Omit<SaveDocumentInput, "userId">) => Promise<number | null>;
  if (ticket !== null) {
    save = (doc) => saveDocumentWithTicket(ticket, doc);
  } else {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    save = (doc) => saveDocument({ ...doc, userId });
  }

  const parsed = parseDocument(await request.json());
  if (parsed instanceof NextResponse) return parsed;

  try {
    const id = await save(parsed);
    if (id === null) return NextResponse.json(TICKET_INVALID_BODY, { status: 401 });
    return NextResponse.json({ id });
  } catch (error) {
    console.error("Document save error:", error);
    return NextResponse.json({ error: "Failed to save document" }, { status: 500 });
  }
}
