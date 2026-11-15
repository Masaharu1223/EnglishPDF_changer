// サーバーの中の翻訳ループ(runTranslation)をテストする。
// Claude の呼び出しと使用量の予約・返却は偽物に差し替え、再試行・締め切り・返す量を確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ClaudeResponseError extends Error {}
  return {
    processChunk: vi.fn(),
    reserveUsage: vi.fn(),
    refundUsage: vi.fn(),
    ClaudeResponseError,
  };
});
vi.mock("@/lib/llm", () => ({
  processChunk: mocks.processChunk,
  ClaudeResponseError: mocks.ClaudeResponseError,
}));
vi.mock("@/lib/usage", () => ({
  reserveUsage: mocks.reserveUsage,
  refundUsage: mocks.refundUsage,
}));

import { BUSY_RETRY_DELAY_MS, runTranslation, type RunInput } from "@/lib/translation-run";

const subject = { type: "user", userId: "u1" } as const;
const FAR = Date.now() + 60_000;

// 引数: 予約した量 / 返り値: 予約情報の偽物
const reservation = (amount: number) => ({
  keys: ["u:u1", "others:*"],
  day: "2026-11-15",
  kind: "translate_chars" as const,
  amount,
});
// 引数: チャンク / 返り値: そのチャンクから作った文の一覧
const sentencesOf = (chunk: string) => [{ original: chunk.slice(0, 3), translation: "訳" }];
// 引数: 上書きする入力 / 返り値: runTranslation の入力
const input = (over: Partial<RunInput> = {}): RunInput => ({
  chunks: ["a".repeat(1000), "b".repeat(300), "c".repeat(1500)],
  subject,
  deadlineAt: FAR,
  onChunk: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
  ...over,
});
// 引数: なし / 返り値: 一番最初の予約(文書全体の分)の偽物
const mainReservation = () => mocks.reserveUsage.mock.results[0].value;
// 引数: なし / 返り値: 文書全体の予約に対して返した量
const refundedFromMain = async () => {
  const main = (await mainReservation()).reservation;
  const call = mocks.refundUsage.mock.calls.find((c) => c[0] === main);
  return call?.[1];
};

beforeEach(() => {
  vi.stubEnv("USAGE_MIN_CHARGE_CHARS", "500");
  mocks.reserveUsage.mockImplementation(async (_s, _k, amount: number) => ({
    ok: true,
    reservation: reservation(amount),
  }));
  mocks.refundUsage.mockResolvedValue(undefined);
  mocks.processChunk.mockImplementation(async (chunk: string) => sentencesOf(chunk));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.processChunk.mockReset();
  mocks.reserveUsage.mockReset();
  mocks.refundUsage.mockReset();
});

describe("全部成功する場合", () => {
  it("文書全体の分(各チャンクの max(文字数, 500))を1回だけ予約し、何も返さない", async () => {
    const result = await runTranslation(input());
    expect(mocks.reserveUsage).toHaveBeenCalledTimes(1);
    expect(mocks.reserveUsage).toHaveBeenCalledWith(subject, "translate_chars", 1000 + 500 + 1500);
    expect(await refundedFromMain()).toBe(0);
    expect(result).toEqual({
      ok: true,
      status: "complete",
      sentences: [...sentencesOf("a".repeat(3)), ...sentencesOf("b".repeat(3)), ...sentencesOf("c".repeat(3))],
      failedChunks: 0,
      notProcessed: 0,
    });
  });

  it("チャンクごとに、順番どおり onChunk を呼ぶ", async () => {
    const onChunk = vi.fn();
    await runTranslation(input({ onChunk }));
    expect(onChunk.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
    expect(onChunk.mock.calls[2][1]).toEqual(sentencesOf("ccc"));
  });

  it("Claude には中断の合図を渡す", async () => {
    await runTranslation(input());
    expect(mocks.processChunk.mock.calls[0][1]).toEqual({ signal: expect.any(AbortSignal) });
  });

  it("onChunk が失敗しても、翻訳は止めない(画面との通信が切れていても続ける)", async () => {
    const onChunk = vi.fn().mockRejectedValue(new Error("stream closed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runTranslation(input({ onChunk }));
    expect(result.ok && result.status).toBe("complete");
    expect(onChunk).toHaveBeenCalledTimes(3);
  });

  it("チャンクが0個なら、予約しない", async () => {
    const result = await runTranslation(input({ chunks: [] }));
    expect(mocks.reserveUsage).not.toHaveBeenCalled();
    expect(result.ok && result.status).toBe("complete");
  });
});

describe("最初の予約", () => {
  it("上限なら、翻訳を始めずに理由を返す", async () => {
    mocks.reserveUsage.mockResolvedValue({ ok: false, reason: "personal" });
    expect(await runTranslation(input())).toEqual({ ok: false, reason: "personal" });
    expect(mocks.processChunk).not.toHaveBeenCalled();
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it("busy なら、数秒待って再試行する(2回目の再試行で通れば続ける)", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    mocks.reserveUsage
      .mockResolvedValueOnce({ ok: false, reason: "busy" })
      .mockResolvedValueOnce({ ok: false, reason: "busy" });
    const result = await runTranslation(input({ sleep }));
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(BUSY_RETRY_DELAY_MS);
    expect(result.ok && result.status).toBe("complete");
  });

  it("busy が3回続いたら、busy を返す(上限とは区別する)", async () => {
    mocks.reserveUsage.mockResolvedValue({ ok: false, reason: "busy" });
    expect(await runTranslation(input())).toEqual({ ok: false, reason: "busy" });
    expect(mocks.reserveUsage).toHaveBeenCalledTimes(3);
  });

  it("上限(pool)は再試行しない", async () => {
    mocks.reserveUsage.mockResolvedValue({ ok: false, reason: "pool" });
    await runTranslation(input());
    expect(mocks.reserveUsage).toHaveBeenCalledTimes(1);
  });
});

describe("失敗したチャンクの再試行", () => {
  it("課金されていない失敗は、追加の予約なしで1回だけ再試行する", async () => {
    mocks.processChunk.mockRejectedValueOnce(new Error("overloaded"));
    const result = await runTranslation(input());
    expect(mocks.processChunk).toHaveBeenCalledTimes(4);
    expect(mocks.reserveUsage).toHaveBeenCalledTimes(1);
    expect(await refundedFromMain()).toBe(0);
    expect(result.ok && result.status).toBe("complete");
  });

  it("課金済みの失敗は、そのチャンクの分を追加で予約してから再試行する", async () => {
    mocks.processChunk.mockRejectedValueOnce(new mocks.ClaudeResponseError("cut off"));
    const result = await runTranslation(input());
    expect(mocks.reserveUsage).toHaveBeenCalledTimes(2);
    expect(mocks.reserveUsage.mock.calls[1][2]).toBe(1000);
    expect(mocks.refundUsage).toHaveBeenCalledTimes(1);
    expect(await refundedFromMain()).toBe(0);
    expect(result.ok && result.status).toBe("complete");
  });

  it("追加の予約ができなければ、再試行しない(そのチャンクは失敗。課金済みなので返さない)", async () => {
    mocks.reserveUsage
      .mockImplementationOnce(async (_s, _k, amount: number) => ({ ok: true, reservation: reservation(amount) }))
      .mockResolvedValueOnce({ ok: false, reason: "personal" });
    mocks.processChunk.mockRejectedValueOnce(new mocks.ClaudeResponseError("cut off"));
    const result = await runTranslation(input());
    expect(mocks.processChunk).toHaveBeenCalledTimes(3);
    expect(await refundedFromMain()).toBe(0);
    expect(result).toMatchObject({ ok: true, status: "failed", failedChunks: 1, notProcessed: 0 });
  });

  it("追加の予約で DB が失敗しても、ループは止めない", async () => {
    mocks.reserveUsage
      .mockImplementationOnce(async (_s, _k, amount: number) => ({ ok: true, reservation: reservation(amount) }))
      .mockRejectedValueOnce(new Error("db down"));
    mocks.processChunk.mockRejectedValueOnce(new mocks.ClaudeResponseError("cut off"));
    const result = await runTranslation(input());
    expect(result).toMatchObject({ ok: true, status: "failed", failedChunks: 1 });
  });

  it("課金済みの失敗のあと、再試行が課金されずに失敗したら、追加の予約を全額返す", async () => {
    mocks.processChunk
      .mockRejectedValueOnce(new mocks.ClaudeResponseError("cut off"))
      .mockRejectedValueOnce(new Error("overloaded"));
    await runTranslation(input());
    const extra = (await mocks.reserveUsage.mock.results[1].value).reservation;
    expect(mocks.refundUsage).toHaveBeenCalledWith(extra);
    expect(await refundedFromMain()).toBe(0);
  });

  it("再試行も課金されずに失敗したら、そのチャンクの分を最後に返し、残りは続ける", async () => {
    mocks.processChunk
      .mockRejectedValueOnce(new Error("overloaded"))
      .mockRejectedValueOnce(new Error("overloaded"));
    const result = await runTranslation(input());
    expect(await refundedFromMain()).toBe(1000);
    expect(result).toMatchObject({ ok: true, status: "failed", failedChunks: 1, notProcessed: 0 });
    expect(result.ok && result.sentences).toHaveLength(2);
  });

  it("3回続けて失敗したら中断し、処理しなかったチャンクと課金されていない失敗の分を返す", async () => {
    const chunks = ["a".repeat(600), "b".repeat(600), "c".repeat(600), "d".repeat(600), "e".repeat(600)];
    mocks.processChunk.mockRejectedValue(new Error("overloaded"));
    const result = await runTranslation(input({ chunks }));
    expect(mocks.processChunk).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({ ok: true, status: "aborted", failedChunks: 3, notProcessed: 2 });
    expect(await refundedFromMain()).toBe(3000);
  });
});

describe("締め切りの見張り", () => {
  it("締め切りを過ぎたら、新しいチャンクを始めず、残りの分を返す", async () => {
    let t = 0;
    mocks.processChunk.mockImplementation(async (chunk: string) => {
      t += 400;
      return sentencesOf(chunk);
    });
    const chunks = ["a".repeat(600), "b".repeat(600), "c".repeat(600), "d".repeat(700), "e".repeat(800)];
    const result = await runTranslation(input({ chunks, deadlineAt: 1000, now: () => t }));
    expect(mocks.processChunk).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ ok: true, status: "incomplete", failedChunks: 0, notProcessed: 2 });
    expect(await refundedFromMain()).toBe(700 + 800);
  });

  it("Claude の失敗の時点で締め切りを過ぎていたら、再試行しない(打ち切ったのではないので「失敗」に数える)", async () => {
    let t = 0;
    mocks.processChunk.mockImplementation(async () => {
      t += 2000;
      throw new Error("overloaded");
    });
    const result = await runTranslation(input({ deadlineAt: 1000, now: () => t }));
    expect(mocks.processChunk).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, status: "incomplete", failedChunks: 1, notProcessed: 2 });
  });

  it("実行中の Claude の呼び出しは、締め切りで打ち切る(課金済みとして扱い、そのチャンクは処理しなかった数に入れる)", async () => {
    mocks.processChunk.mockImplementation(
      (_chunk: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new mocks.ClaudeResponseError("aborted")));
        })
    );
    const result = await runTranslation(input({ deadlineAt: Date.now() + 50 }));
    expect(mocks.processChunk).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, status: "incomplete", failedChunks: 0, notProcessed: 3 });
    expect(await refundedFromMain()).toBe(500 + 1500);
  });

  it("始める時点で締め切りを過ぎていたら、予約もしない", async () => {
    const result = await runTranslation(input({ deadlineAt: 1000, now: () => 1000 }));
    expect(mocks.reserveUsage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, status: "incomplete", notProcessed: 3 });
  });

  it("課金なしの失敗のあと、再試行が締め切りで打ち切られたら、そのチャンクの分を残し、処理しなかった数に入れる", async () => {
    mocks.processChunk
      .mockRejectedValueOnce(new Error("overloaded"))
      .mockImplementationOnce(
        (_chunk: string, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new mocks.ClaudeResponseError("aborted")));
          })
      );
    const result = await runTranslation(input({ deadlineAt: Date.now() + 50 }));
    expect(mocks.processChunk).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: true, status: "incomplete", failedChunks: 0, notProcessed: 3 });
    expect(await refundedFromMain()).toBe(500 + 1500);
  });

  it("課金済みの失敗のあと、追加の予約をした再試行が締め切りで打ち切られたら、追加の分も返さない", async () => {
    mocks.processChunk
      .mockRejectedValueOnce(new mocks.ClaudeResponseError("cut off"))
      .mockImplementationOnce(
        (_chunk: string, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new mocks.ClaudeResponseError("aborted")));
          })
      );
    const result = await runTranslation(input({ deadlineAt: Date.now() + 50 }));
    const extra = (await mocks.reserveUsage.mock.results[1].value).reservation;
    expect(mocks.refundUsage).not.toHaveBeenCalledWith(extra);
    expect(result).toMatchObject({ ok: true, status: "incomplete", notProcessed: 3 });
  });

  it("追加の予約を待つあいだに締め切りが来たら、再試行せず、追加の分を返す", async () => {
    mocks.reserveUsage
      .mockImplementationOnce(async (_s, _k, amount: number) => ({ ok: true, reservation: reservation(amount) }))
      .mockImplementationOnce(async (_s, _k, amount: number) => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { ok: true, reservation: reservation(amount) };
      });
    mocks.processChunk.mockRejectedValueOnce(new mocks.ClaudeResponseError("cut off"));
    const result = await runTranslation(input({ deadlineAt: Date.now() + 30 }));
    const extra = (await mocks.reserveUsage.mock.results[1].value).reservation;
    expect(mocks.processChunk).toHaveBeenCalledTimes(1);
    expect(mocks.refundUsage).toHaveBeenCalledWith(extra);
    expect(result).toMatchObject({ ok: true, status: "incomplete", notProcessed: 3 });
    expect(await refundedFromMain()).toBe(500 + 1500);
  });

  it("チャンクの途中でタイマーが先に切れていたら、時計がまだでも次のチャンクを始めない", async () => {
    mocks.processChunk.mockImplementationOnce(async (chunk: string) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return sentencesOf(chunk);
    });
    const result = await runTranslation(input({ deadlineAt: 30, now: () => 0 }));
    expect(mocks.processChunk).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, status: "incomplete", notProcessed: 2 });
  });

  it("締め切りがとても遠くても、時刻が小数でも、タイマーの範囲の例外で止まらない", async () => {
    const far = await runTranslation(input({ deadlineAt: Date.now() + 2 ** 33 }));
    const fractional = await runTranslation(input({ deadlineAt: 60_000.7, now: () => 0.3 }));
    const infinite = await runTranslation(input({ deadlineAt: Infinity }));
    for (const result of [far, fractional, infinite]) {
      expect(result.ok && result.status).toBe("complete");
    }
  });
});
