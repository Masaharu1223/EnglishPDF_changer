import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Anthropic SDK は偽物に差し替える(外部APIは呼ばない・費用がかからない)。
// 確かめたいのは、Claudeの応答を受けたあとの失敗と、呼ぶ前の失敗を区別できているか。
const mocks = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  // SDK の「接続できなかった・タイムアウトした」例外の代わり(llm.ts は instanceof で見分ける)
  class APIConnectionError extends Error {}
  return { create: vi.fn(), APIConnectionError };
});
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    static APIConnectionError = mocks.APIConnectionError;
    messages = { create: mocks.create };
  },
}));

import { ClaudeResponseError, cleanText, maxTokensFor, processChunk, splitIntoChunks } from "@/lib/llm";

const response = (over: Record<string, unknown> = {}) => ({
  stop_reason: "tool_use",
  usage: { input_tokens: 100, output_tokens: 50 },
  content: [{ type: "tool_use", input: { sentences: [{ original: "Hi.", translation: "やあ。" }] } }],
  ...over,
});

beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  mocks.create.mockReset();
});

describe("processChunk: 課金されたかもしれない失敗は、返却させない", () => {
  it("接続の失敗・タイムアウトは ClaudeResponseError(サーバー側で生成と課金が進んでいるかもしれない)", async () => {
    mocks.create.mockRejectedValue(new mocks.APIConnectionError("timeout"));
    await expect(processChunk("Hello.")).rejects.toBeInstanceOf(ClaudeResponseError);
  });

  it("応答を受け取ったあとの想定外の例外(usage が無いなど)も ClaudeResponseError", async () => {
    mocks.create.mockResolvedValue({ stop_reason: "tool_use", content: [] }); // usage が undefined → TypeError
    await expect(processChunk("Hello.")).rejects.toBeInstanceOf(ClaudeResponseError);
  });
});

describe("maxTokensFor(出力の上限を chunk の長さに合わせる)", () => {
  it("短い chunk には小さい上限、長い chunk でも 8192 を超えない", () => {
    expect(maxTokensFor("a".repeat(10))).toBeLessThan(1_000);
    expect(maxTokensFor("a".repeat(1_500))).toBeGreaterThan(maxTokensFor("a".repeat(10)));
    expect(maxTokensFor("a".repeat(100_000))).toBe(8_192);
  });

  it("実測(出力は約1.2トークン/文字)に対して約1.7倍の余裕があり、予約の見積もりを大きく超えない", () => {
    const MEASURED_TOKENS_PER_CHAR = 1.2;
    for (const n of [200, 680, 1_500, 2_000]) {
      const max = maxTokensFor("a".repeat(n));
      expect(max).toBeGreaterThanOrEqual(n * MEASURED_TOKENS_PER_CHAR * 1.5);
      expect(max).toBeLessThanOrEqual(n * MEASURED_TOKENS_PER_CHAR * 2.5 + 300);
    }
  });
});

describe("processChunk", () => {
  it("成功: 文のペアを返し、chunk に合わせた max_tokens で呼ぶ", async () => {
    mocks.create.mockResolvedValue(response());
    expect(await processChunk("Hello.")).toEqual([{ original: "Hi.", translation: "やあ。" }]);
    expect(mocks.create.mock.calls[0][0].max_tokens).toBe(maxTokensFor("Hello."));
    expect(mocks.create.mock.calls[0][0].max_tokens).toBeLessThan(8_192);
  });

  it.each([
    ["tool_use がない", response({ content: [{ type: "text", text: "no" }] })],
    ["sentences が配列でない", response({ content: [{ type: "tool_use", input: {} }] })],
    ["出力が上限で途中で切れた", response({ stop_reason: "max_tokens" })],
  ])("Claudeが応答したあとの失敗(%s)は ClaudeResponseError(課金済みなので返却してはいけない)", async (_n, res) => {
    mocks.create.mockResolvedValue(res);
    await expect(processChunk("Hello.")).rejects.toBeInstanceOf(ClaudeResponseError);
  });

  it("Claudeが拒否した失敗(4xx/5xx・レート制限など)は ClaudeResponseError ではない(課金されていないので返却してよい)", async () => {
    mocks.create.mockRejectedValue(new Error("529 overloaded"));
    const err = await processChunk("Hello.").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ClaudeResponseError);
  });
});

describe("splitIntoChunks: 句読点のない長い文章でも、サーバーが受け付ける長さに収める", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

  it("句読点がない長文は、空白の位置で最大文字数に収まるように分け、単語を欠かさない", () => {
    const text = words(1_000); // 約6,900文字、句読点なし
    const chunks = splitIntoChunks(cleanText(text));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1_501);
    expect(chunks.join(" ")).toBe(text); // 欠けも重複もない
  });

  it("空白もない超長文は、最大文字数で強制的に分ける(2,000文字を超えるチャンクを作らない)", () => {
    const chunks = splitIntoChunks("a".repeat(4_000));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1_501);
    expect(chunks.join("")).toBe("a".repeat(4_000));
  });

  it("通常の文章の分け方は変わらない(文の途中で切らない)", () => {
    const sentence = "This is a normal sentence.";
    const text = Array.from({ length: 200 }, () => sentence).join(" ");
    const chunks = splitIntoChunks(text);
    for (const c of chunks) expect(c.endsWith(".")).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });
});
