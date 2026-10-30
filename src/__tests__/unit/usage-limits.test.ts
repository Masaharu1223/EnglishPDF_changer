import { afterEach, describe, expect, it, vi } from "vitest";
import { getUsageLimits } from "@/lib/usage-limits";

afterEach(() => vi.unstubAllEnvs());

describe("getUsageLimits", () => {
  it("環境変数がなければ既定値を使う(自分以外の全員の合計は月5,000円に収まる10万文字/日)", () => {
    expect(getUsageLimits()).toEqual({
      anonIpChars: 12_000,
      anonTotalChars: 48_000,
      userChars: 30_000,
      othersTotalChars: 100_000,
      ownerChars: 100_000,
      maxTranslateChunkChars: 2_000,
      lockTimeoutMs: 5_000,
      minChargeChars: 500,
    });
  });

  it("最低課金(文字数)は、環境変数 USAGE_MIN_CHARGE_CHARS で変えられる", () => {
    vi.stubEnv("USAGE_MIN_CHARGE_CHARS", "300");
    expect(getUsageLimits().minChargeChars).toBe(300);
  });

  it("int32 を超える値は無視して既定値にする(DBの int に入らず全リクエストが500になるのを防ぐ)", () => {
    vi.stubEnv("USAGE_LIMIT_USER_CHARS", "2147483648");
    expect(getUsageLimits().userChars).toBe(30_000);
    vi.stubEnv("USAGE_LIMIT_USER_CHARS", "2147483647");
    expect(getUsageLimits().userChars).toBe(2_147_483_647);
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

  it("ロックの待ち時間(ミリ秒)は、既定5秒で、環境変数 USAGE_LOCK_TIMEOUT_MS で変えられる", () => {
    expect(getUsageLimits().lockTimeoutMs).toBe(5_000);
    vi.stubEnv("USAGE_LOCK_TIMEOUT_MS", "1000");
    expect(getUsageLimits().lockTimeoutMs).toBe(1000);
  });

  it.each(["0", "-1", "abc", "1.5"])(
    "ロックの待ち時間の不正な値(%j)は無視して既定値にする(待ち時間なし・無限にならない)",
    (bad) => {
      vi.stubEnv("USAGE_LOCK_TIMEOUT_MS", bad);
      expect(getUsageLimits().lockTimeoutMs).toBe(5_000);
    }
  );

  it("呼ぶたびに環境変数を読み直す", () => {
    vi.stubEnv("USAGE_LIMIT_USER_CHARS", "100");
    expect(getUsageLimits().userChars).toBe(100);
    vi.stubEnv("USAGE_LIMIT_USER_CHARS", "200");
    expect(getUsageLimits().userChars).toBe(200);
  });
});
