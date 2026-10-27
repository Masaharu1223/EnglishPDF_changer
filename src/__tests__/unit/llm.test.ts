import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Anthropic SDK は偽物に差し替える(外部APIは呼ばない・費用がかからない)。
// 確かめたいのは、Claudeの応答を受けたあとの失敗と、呼ぶ前の失敗を区別できているか。
const mocks = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  return { create: vi.fn() };
});
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mocks.create };
  },
}));

import { ClaudeResponseError, maxTokensFor, processChunk } from "@/lib/llm";

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

describe("maxTokensFor(出力の上限を chunk の長さに合わせる)", () => {
  it("短い chunk には小さい上限、長い chunk でも 8192 を超えない", () => {
    expect(maxTokensFor("a".repeat(10))).toBeLessThan(1_000);
    expect(maxTokensFor("a".repeat(1_500))).toBeGreaterThan(maxTokensFor("a".repeat(10)));
    expect(maxTokensFor("a".repeat(100_000))).toBe(8_192);
  });

  it("日本語のようにトークンを多く使う入力でも、訳が途中で切れない余裕がある(1文字あたり4トークン以上)", () => {
    expect(maxTokensFor("あ".repeat(1_000))).toBeGreaterThanOrEqual(4_000);
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

  it("API呼び出し自体の失敗(通信エラーなど)は ClaudeResponseError ではない(課金されていないので返却してよい)", async () => {
    mocks.create.mockRejectedValue(new Error("network"));
    const err = await processChunk("Hello.").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ClaudeResponseError);
  });
});
