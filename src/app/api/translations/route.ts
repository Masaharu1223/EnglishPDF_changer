// 翻訳API。本文かファイルを1回で受け取り、サーバーの中で全部のチャンクを翻訳する。
// 使用量を予約できたら 200 を返し、進み具合を NDJSON で流して、最後に全部の文をまとめて返す。
// 画面との通信が切れても、翻訳は最後まで続ける。ログイン中で最後まで終われば、履歴に保存する。

import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { fitsDocumentLimits, MAX_TITLE_CHARS } from "@/lib/document-limits";
import { saveDocument, type SaveDocumentInput } from "@/lib/documents";
import { cleanText, splitIntoChunks } from "@/lib/llm";
import { extractTextFromPDF, extractTextFromTXT } from "@/lib/pdf-parser";
import { encodeEvent, type TranslationEvent } from "@/lib/translation-events";
import { chargesFor, runTranslation, type RunResult } from "@/lib/translation-run";
import { subjectFor } from "@/lib/usage";
import { busyResponse, limitResponse } from "@/lib/usage-response";

export const maxDuration = 300;

// 受付から締め切りまでの時間。maxDuration(300秒)との差の60秒を、保存と後片付けにあてる
const DEADLINE_MS = 240_000;
const MAX_TEXT_CHARS = 30_000;
const PING_INTERVAL_MS = 15_000;
const PING_CHECK_MS = 5_000;

const ERROR_MESSAGE = "翻訳の途中で問題が起きました。時間をおいて、もう一度お試しください。";

type Input = {
  title: string;
  sourceType: SaveDocumentInput["sourceType"];
  getText: () => Promise<string>;
};

// 引数: エラーの文言、ステータス、追加の項目 / 返り値: JSON のエラー応答
function errorResponse(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

// 引数: リクエストの本文 / 返り値: 題名・入力の種類・本文を取り出す関数、または 400 の応答
function parseInput(body: unknown): Input | NextResponse {
  if (typeof body !== "object" || body === null) return errorResponse("Invalid body", 400);
  const { title, text, fileName, fileData } = body as Record<string, unknown>;
  if (typeof title !== "string" || title.length < 1 || title.length > MAX_TITLE_CHARS) {
    return errorResponse("Invalid title", 400);
  }

  if (typeof fileName === "string" && typeof fileData === "string") {
    const name = fileName.toLowerCase();
    const buffer = () => Buffer.from(fileData, "base64");
    if (name.endsWith(".pdf")) {
      return { title, sourceType: "pdf", getText: () => extractTextFromPDF(buffer()) };
    }
    if (name.endsWith(".txt")) {
      return { title, sourceType: "txt", getText: async () => extractTextFromTXT(buffer()) };
    }
    return errorResponse("Unsupported file type. Please upload a PDF or TXT file.", 400);
  }

  if (typeof text === "string") return { title, sourceType: "paste", getText: async () => text };
  return errorResponse("No text or file provided", 400);
}

// 引数: なし / 返り値: 画面へ流すストリームと、書き込み・終了の関数(通信が切れたあとの書き込みは黙って捨てる)
function createEventStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let lastSentAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });

  return {
    stream,
    send(event: TranslationEvent) {
      if (closed || !controller) return;
      try {
        controller.enqueue(encoder.encode(encodeEvent(event)));
        lastSentAt = Date.now();
      } catch {
        closed = true;
      }
    },
    close() {
      if (closed || !controller) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // すでに閉じられている
      }
    },
    idleMs: () => Date.now() - lastSentAt,
  };
}

// 引数: 翻訳の結果、保存先のユーザー(未ログインなら null)、題名・入力の種類・原文 / 返り値: 保存した教材の id と、保存に失敗したか
async function saveIfComplete(
  result: Extract<RunResult, { ok: true }>,
  userId: string | null,
  doc: Omit<SaveDocumentInput, "userId" | "sentences">
): Promise<{ documentId: number | null; saveFailed: boolean }> {
  if (result.status !== "complete" || !userId || result.sentences.length === 0) {
    return { documentId: null, saveFailed: false };
  }
  const sentences = result.sentences.map((s, position) => ({
    position,
    original: s.original,
    translation: s.translation,
  }));
  if (!fitsDocumentLimits(doc.rawText, sentences)) {
    console.error("Translation result exceeds document limits; not saved");
    return { documentId: null, saveFailed: true };
  }
  try {
    return { documentId: await saveDocument({ ...doc, userId, sentences }), saveFailed: false };
  } catch (error) {
    console.error("Failed to save translated document:", error);
    return { documentId: null, saveFailed: true };
  }
}

// 引数: request(JSON で title と、text か fileName・fileData のどちらか) / 返り値: 4xx の応答、または NDJSON の 200 応答
export async function POST(request: NextRequest) {
  const deadlineAt = Date.now() + DEADLINE_MS;

  try {
    const input = parseInput(await request.json().catch(() => null));
    if (input instanceof NextResponse) return input;

    const session = await auth.api.getSession({ headers: request.headers });
    const subject = subjectFor(session, request.headers);
    const userId = session?.user?.id ?? null;

    let rawText: string;
    try {
      rawText = await input.getText();
    } catch (error) {
      console.error("Failed to read the uploaded file:", error);
      return errorResponse("Could not read the file.", 400);
    }
    const cleaned = cleanText(rawText);
    if (!cleaned.trim()) return errorResponse("No text could be extracted.", 400);
    if (cleaned.length > MAX_TEXT_CHARS) {
      return errorResponse(
        `文章が長すぎます。一度に翻訳できるのは ${MAX_TEXT_CHARS.toLocaleString("ja-JP")} 字までです。`,
        413,
        { reason: "too_long", maxChars: MAX_TEXT_CHARS }
      );
    }
    const chunks = splitIntoChunks(cleaned);

    const events = createEventStream();
    let started = false;
    const sendStart = () => {
      if (started) return;
      started = true;
      events.send({ type: "start", totalChunks: chunks.length });
    };

    // 関数を最後まで生かす約束を、翻訳を始める前に after() に渡す。登録に失敗したら、何も始めずに 500 で終わる
    let release!: () => void;
    after(new Promise<void>((resolve) => (release = resolve)));

    let markReserved!: () => void;
    const reserved = new Promise<"reserved">((resolve) => {
      markReserved = () => resolve("reserved");
    });
    const run = runTranslation({
      chunks,
      subject,
      deadlineAt,
      onReserved: () => {
        sendStart();
        markReserved();
      },
      onChunk: (index) => {
        events.send({ type: "progress", completedChunks: index + 1, totalChunks: chunks.length });
      },
    });

    // どの経路(200・429・500)でも、run が終われば必ず後片付けをして release する
    void (async () => {
      const ping = setInterval(() => {
        if (started && events.idleMs() >= PING_INTERVAL_MS) events.send({ type: "ping" });
      }, PING_CHECK_MS);
      try {
        const result = await run;
        if (!result.ok) return; // 予約の失敗は、下で 429 として返す
        sendStart();
        const saved = await saveIfComplete(result, userId, {
          title: input.title,
          sourceType: input.sourceType,
          rawText,
        });
        events.send({
          type: "done",
          status: result.status,
          sentences: result.sentences,
          failedChunks: result.failedChunks,
          notProcessed: result.notProcessed,
          ...saved,
        });
      } catch (error) {
        console.error("Translation stream error:", error);
        events.send({ type: "error", error: ERROR_MESSAGE });
      } finally {
        clearInterval(ping);
        events.close();
        release();
      }
    })();

    const first = await Promise.race([reserved, run]);
    if (first !== "reserved" && !first.ok) {
      return first.reason === "busy"
        ? busyResponse()
        : limitResponse(first.reason, subject, chargesFor(chunks).reduce((a, b) => a + b, 0));
    }
    sendStart();

    return new Response(events.stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    console.error("Translations error:", error);
    return errorResponse(ERROR_MESSAGE, 500);
  }
}
