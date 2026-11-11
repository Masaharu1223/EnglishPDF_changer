// 翻訳チケットの、DB を使わない計算(使える文字数とハッシュ)をテストする。
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

import { budgetFor, sha256Hex } from "@/lib/translation-ticket";

describe("budgetFor(チケットで翻訳できる文字数)", () => {
  it("各チャンクの文字数の合計。短いチャンクは最低課金の文字数で数える", () => {
    expect(budgetFor(["a".repeat(1_500), "b".repeat(100)], 500)).toBe(2_000);
  });

  it("チャンクがなければ 0", () => {
    expect(budgetFor([], 500)).toBe(0);
  });
});

describe("sha256Hex", () => {
  it("同じ入力なら同じ値、違う入力なら違う値。元の文字列は含まない", () => {
    expect(sha256Hex("ticket")).toBe(sha256Hex("ticket"));
    expect(sha256Hex("ticket")).not.toBe(sha256Hex("ticket2"));
    expect(sha256Hex("ticket")).toMatch(/^[0-9a-f]{64}$/);
  });
});
