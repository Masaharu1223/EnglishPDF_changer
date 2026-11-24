// 翻訳API(/api/translations)が、1行に1つずつ流す知らせ(NDJSON)の型。サーバーと画面の両方から読み込む。

import type { SentencePair } from "@/lib/llm";
import type { RunStatus } from "@/lib/translation-run";

export type TranslationEvent =
  | { type: "start"; totalChunks: number }
  | { type: "progress"; completedChunks: number; totalChunks: number }
  | { type: "ping" }
  | {
      type: "done";
      status: RunStatus;
      sentences: SentencePair[];
      failedChunks: number;
      notProcessed: number;
      documentId: number | null;
      saveFailed: boolean;
    }
  | { type: "error"; error: string };

// 引数: 知らせ / 返り値: NDJSON の1行(末尾に改行)
export function encodeEvent(event: TranslationEvent): string {
  return `${JSON.stringify(event)}\n`;
}
