import { afterEach, describe, expect, it, vi } from "vitest";
import { getUsageLimits } from "@/lib/usage-limits";

afterEach(() => vi.unstubAllEnvs());

describe("getUsageLimits", () => {
  it("環境変数がなければ既定値を使う(自分以外の全員の合計は月5,000円に収まる14万文字/日)", () => {
    expect(getUsageLimits()).toEqual({
      anonIpChars: 12_000,
      anonTotalChars: 48_000,
      userChars: 30_000,
      othersTotalChars: 140_000,
      ownerChars: 100_000,
      maxTranslateChunkChars: 2_000,
    });
  });

  it("正の整数なら、環境変数で上書きできる", () => {
    vi.stubEnv("USAGE_LIMIT_ANON_IP_CHARS", "5000");
    vi.stubEnv("MAX_TRANSLATE_CHUNK_CHARS", "1500");
    const limits = getUsageLimits();
    expect(limits.anonIpChars).toBe(5000);
    expect(limits.maxTranslateChunkChars).toBe(1500);
  });

  it.each(["abc", "-1", "0", "1.5", "", "   ", "NaN", "Infinity"])(
    "不正な値(%j)は無視して既定値にする(設定ミスで制限が外れない)",
    (bad) => {
      vi.stubEnv("USAGE_LIMIT_ANON_IP_CHARS", bad);
      expect(getUsageLimits().anonIpChars).toBe(12_000);
    }
  );

  it("呼ぶたびに環境変数を読み直す", () => {
    vi.stubEnv("USAGE_LIMIT_USER_CHARS", "100");
    expect(getUsageLimits().userChars).toBe(100);
    vi.stubEnv("USAGE_LIMIT_USER_CHARS", "200");
    expect(getUsageLimits().userChars).toBe(200);
  });
});
