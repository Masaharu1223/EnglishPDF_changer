// サーバーの中で、チャンクを順番に翻訳する(HTTP から独立した処理)。
// 使用量は最初に文書全体の分をまとめて予約し、最後に使わなかった分をまとめて返す。

import { ClaudeResponseError, processChunk, type SentencePair } from "@/lib/llm";
import { refundUsage, reserveUsage, type UsageSubject } from "@/lib/usage";
import { getUsageLimits } from "@/lib/usage-limits";

export const MAX_CONSECUTIVE_FAILURES = 3;
export const BUSY_RETRIES = 2;
export const BUSY_RETRY_DELAY_MS = 2_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

export type RunStatus = "complete" | "incomplete" | "failed" | "aborted";

export interface RunInput {
  chunks: string[];
  subject: UsageSubject;
  deadlineAt: number;
  onChunk: (index: number, sentences: SentencePair[]) => void | Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type RunResult =
  | { ok: false; reason: "personal" | "pool" | "busy" }
  | {
      ok: true;
      status: RunStatus;
      sentences: SentencePair[];
      failedChunks: number;
      notProcessed: number;
    };

type Attempt = { ok: true; sentences: SentencePair[] } | { ok: false; charged: boolean };

interface ChunkOutcome {
  sentences: SentencePair[] | null;
  keepMain: boolean;
  cutByDeadline: boolean;
}

// 引数: ms(待つミリ秒) / 返り値: 待ち終わると解決する Promise
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 引数: 締め切りまでの残り時間(ミリ秒) / 返り値: タイマーに渡せる範囲の整数
function timerDelay(ms: number): number {
  return Number.isFinite(ms) ? Math.min(MAX_TIMER_MS, Math.max(0, Math.ceil(ms))) : MAX_TIMER_MS;
}

// 引数: 使用量の対象、予約する量、待つ関数 / 返り値: 予約の結果(busy なら数回まで待って再試行する)
async function reserveWithRetry(
  subject: UsageSubject,
  amount: number,
  sleep: (ms: number) => Promise<void>
) {
  for (let i = 0; ; i++) {
    const result = await reserveUsage(subject, "translate_chars", amount);
    if (result.ok || result.reason !== "busy" || i >= BUSY_RETRIES) return result;
    await sleep(BUSY_RETRY_DELAY_MS);
  }
}

// 引数: チャンク、中断の合図 / 返り値: 成功なら文の一覧、失敗なら課金されたかどうか
async function attempt(chunk: string, signal: AbortSignal): Promise<Attempt> {
  try {
    return { ok: true, sentences: await processChunk(chunk, { signal }) };
  } catch (error) {
    return { ok: false, charged: error instanceof ClaudeResponseError };
  }
}

// 引数: 試行の結果、中断の合図、最初の予約の分を使ったか / 返り値: 1チャンク分の結果
function outcomeOf(result: Attempt, signal: AbortSignal, keepMain: boolean): ChunkOutcome {
  if (result.ok) return { sentences: result.sentences, keepMain, cutByDeadline: false };
  return { sentences: null, keepMain, cutByDeadline: signal.aborted };
}

// 引数: チャンク、その課金額、使用量の対象、中断の合図、締め切りを過ぎたか / 返り値: 1チャンク分の結果(1回まで再試行する)
async function translateChunk(
  chunk: string,
  charge: number,
  subject: UsageSubject,
  signal: AbortSignal,
  pastDeadline: () => boolean
): Promise<ChunkOutcome> {
  const first = await attempt(chunk, signal);
  if (first.ok || signal.aborted || pastDeadline()) {
    return outcomeOf(first, signal, first.ok || first.charged);
  }

  if (!first.charged) {
    const second = await attempt(chunk, signal);
    return outcomeOf(second, signal, second.ok || second.charged);
  }

  const extra = await reserveUsage(subject, "translate_chars", charge).catch((error) => {
    console.error("Failed to reserve usage for retry", error);
    return null;
  });
  if (!extra?.ok) return outcomeOf(first, signal, true);
  if (signal.aborted) {
    await refundUsage(extra.reservation);
    return outcomeOf(first, signal, true);
  }
  const second = await attempt(chunk, signal);
  if (!second.ok && !second.charged) await refundUsage(extra.reservation);
  return outcomeOf(second, signal, true);
}

// 引数: チャンク・使用量の対象・締め切り・1チャンクごとの通知 / 返り値: 予約の失敗、または翻訳の結果
export async function runTranslation(input: RunInput): Promise<RunResult> {
  const { chunks, subject, deadlineAt, onChunk } = input;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;

  if (chunks.length === 0) {
    return { ok: true, status: "complete", sentences: [], failedChunks: 0, notProcessed: 0 };
  }
  if (now() >= deadlineAt) {
    return { ok: true, status: "incomplete", sentences: [], failedChunks: 0, notProcessed: chunks.length };
  }

  const { minChargeChars } = getUsageLimits();
  const charges = chunks.map((chunk) => Math.max(chunk.length, minChargeChars));
  const total = charges.reduce((sum, charge) => sum + charge, 0);
  const signal = AbortSignal.timeout(timerDelay(deadlineAt - now()));
  const pastDeadline = () => signal.aborted || now() >= deadlineAt;

  const reserved = await reserveWithRetry(subject, total, sleep);
  if (!reserved.ok) return { ok: false, reason: reserved.reason };

  const sentences: SentencePair[] = [];
  let kept = 0;
  let failedChunks = 0;
  let consecutiveFailures = 0;
  let stopped: { by: "deadline" | "failures"; notProcessed: number } | null = null;

  try {
    for (let i = 0; i < chunks.length && !stopped; i++) {
      if (pastDeadline()) {
        stopped = { by: "deadline", notProcessed: chunks.length - i };
        break;
      }

      const outcome = await translateChunk(chunks[i], charges[i], subject, signal, pastDeadline);
      if (outcome.keepMain) kept += charges[i];

      if (outcome.sentences) {
        sentences.push(...outcome.sentences);
        consecutiveFailures = 0;
        try {
          await onChunk(i, outcome.sentences);
        } catch (error) {
          console.error("onChunk failed", error);
        }
      } else if (outcome.cutByDeadline) {
        stopped = { by: "deadline", notProcessed: chunks.length - i };
      } else {
        failedChunks += 1;
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stopped = { by: "failures", notProcessed: chunks.length - (i + 1) };
        }
      }
    }
  } finally {
    await refundUsage(reserved.reservation, total - kept);
  }

  const status: RunStatus =
    stopped?.by === "deadline"
      ? "incomplete"
      : stopped?.by === "failures"
        ? "aborted"
        : failedChunks > 0
          ? "failed"
          : "complete";
  return { ok: true, status, sentences, failedChunks, notProcessed: stopped?.notProcessed ?? 0 };
}
