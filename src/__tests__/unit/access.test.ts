import { afterEach, describe, expect, it, vi } from "vitest";
import { isFeatureAllowed, parseAllowedEmails } from "@/lib/access";

afterEach(() => vi.unstubAllEnvs());

describe("parseAllowedEmails", () => {
  it("前後の空白を除き、小文字にそろえ、空の要素は捨てる", () => {
    expect(Array.from(parseAllowedEmails(" A@x.com, b@y.com ,, "))).toEqual(["a@x.com", "b@y.com"]);
  });

  it("重複は1つにまとまる", () => {
    expect(parseAllowedEmails("a@x.com,A@X.com").size).toBe(1);
  });

  it("未設定・空文字は、空の集合(誰も許可しない)", () => {
    expect(parseAllowedEmails(undefined).size).toBe(0);
    expect(parseAllowedEmails("").size).toBe(0);
    expect(parseAllowedEmails(" , ").size).toBe(0);
  });
});

describe("isFeatureAllowed", () => {
  const allowed = "owner@example.com";

  it("許可リストに入っていて、メールが確認済みなら許可する", () => {
    expect(isFeatureAllowed({ email: "owner@example.com", emailVerified: true }, allowed)).toBe(true);
  });

  it("メールアドレスの大文字小文字は区別しない", () => {
    expect(isFeatureAllowed({ email: "Owner@Example.COM", emailVerified: true }, allowed)).toBe(true);
  });

  it("メールが未確認なら許可しない(他人のアドレスで登録される恐れに備える)", () => {
    expect(isFeatureAllowed({ email: "owner@example.com", emailVerified: false }, allowed)).toBe(false);
    expect(isFeatureAllowed({ email: "owner@example.com", emailVerified: null }, allowed)).toBe(false);
    expect(isFeatureAllowed({ email: "owner@example.com" }, allowed)).toBe(false);
  });

  it("許可リストにないアドレスは許可しない(前方一致・部分一致もしない)", () => {
    expect(isFeatureAllowed({ email: "other@example.com", emailVerified: true }, allowed)).toBe(false);
    expect(isFeatureAllowed({ email: "xowner@example.com", emailVerified: true }, allowed)).toBe(false);
    expect(isFeatureAllowed({ email: "owner@example.com.evil.com", emailVerified: true }, allowed)).toBe(false);
  });

  it("ユーザーなし・メールなしは許可しない", () => {
    expect(isFeatureAllowed(null, allowed)).toBe(false);
    expect(isFeatureAllowed(undefined, allowed)).toBe(false);
    expect(isFeatureAllowed({ email: null, emailVerified: true }, allowed)).toBe(false);
  });

  it("許可リストが空・未設定なら、誰も許可しない(安全側)", () => {
    expect(isFeatureAllowed({ email: "owner@example.com", emailVerified: true }, "")).toBe(false);
    expect(isFeatureAllowed({ email: "owner@example.com", emailVerified: true }, undefined)).toBe(false);
  });

  it("引数を省略すると、環境変数 FEATURE_ALLOWED_EMAILS を読む", () => {
    vi.stubEnv("FEATURE_ALLOWED_EMAILS", "env@example.com");
    expect(isFeatureAllowed({ email: "env@example.com", emailVerified: true })).toBe(true);
    expect(isFeatureAllowed({ email: "owner@example.com", emailVerified: true })).toBe(false);
  });
});
