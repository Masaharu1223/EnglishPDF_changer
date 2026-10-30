import { describe, expect, it } from "vitest";
import { formatDateTimeJST, overLimitMessage } from "@/lib/format";
import type { UsageInfo } from "@/types";

const usage = (over: Partial<UsageInfo["translate"]> = {}, loggedIn = false): UsageInfo => ({
  loggedIn,
  capabilities: { tts: false },
  translate: {
    remaining: 300,
    limit: 12_000,
    minCharge: 500,
    constrainedBy: "personal",
    resetAt: "2026-10-16T00:00:00.000Z",
    ...over,
  },
});

describe("formatDateTimeJST", () => {
  it("UTCの時刻を日本時間で表示し、タイムゾーンを明記する", () => {
    expect(formatDateTimeJST("2026-10-16T00:00:00.000Z")).toBe("2026/10/16 09:00 (JST)");
  });
});

describe("overLimitMessage(翻訳を始める前の警告)", () => {
  it("文書の文字数と残りの文字数を、桁区切りで示す", () => {
    const msg = overLimitMessage(12_345, usage({ remaining: 1_200 }));
    expect(msg).toContain("12,345文字");
    expect(msg).toContain("1,200文字");
    expect(msg).toContain("翻訳を始めませんでした");
  });

  it("リセット時刻は、タイムゾーン(JST)つきで示す", () => {
    expect(overLimitMessage(500, usage())).toContain("2026/10/16 09:00 (JST)");
  });

  it("未ログインには、ログインの案内を出す", () => {
    expect(overLimitMessage(500, usage({}, false))).toContain("ログインすると");
  });

  it("ログイン済みには、ログインの案内を出さず、短くするか待つよう案内する", () => {
    const msg = overLimitMessage(500, usage({}, true));
    expect(msg).not.toContain("ログインすると");
    expect(msg).toContain("リセット後");
  });

  it("全体の上限が制約のときだけ、その旨を足す", () => {
    expect(overLimitMessage(500, usage({ constrainedBy: "pool" }))).toContain("全体の利用上限");
    expect(overLimitMessage(500, usage({ constrainedBy: "personal" }))).not.toContain("全体の利用上限");
  });
});
