import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bucketsFor, limitMessage, nextResetAtIso, subjectFor } from "@/lib/usage";
import { getUsageLimits } from "@/lib/usage-limits";
import { formatDateTimeJST } from "@/lib/format";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-for-unit-tests");
  vi.stubEnv("FEATURE_ALLOWED_EMAILS", "owner@example.com");
});
afterEach(() => vi.unstubAllEnvs());

const limits = () => getUsageLimits();
const session = (email: string, emailVerified = true) => ({ user: { id: `id-${email}`, email, emailVerified } });

describe("subjectFor(誰の使用量として数えるか)", () => {
  it("セッションがなければ、未ログイン(anon)として、IPを記録する", () => {
    const s = subjectFor(null, new Headers({ "x-forwarded-for": "198.51.100.7" }));
    expect(s).toEqual({ type: "anon", ip: "198.51.100.7" });
  });

  it("許可リストにないログイン済みユーザーは user(予算に数える)", () => {
    expect(subjectFor(session("someone@example.com"), new Headers()).type).toBe("user");
  });

  it("許可リストに入っていて、メール確認済みなら owner(予算に数えない)", () => {
    expect(subjectFor(session("owner@example.com"), new Headers())).toEqual({
      type: "owner",
      userId: "id-owner@example.com",
    });
  });

  it("許可リストに入っていても、メール未確認なら user", () => {
    expect(subjectFor(session("owner@example.com", false), new Headers()).type).toBe("user");
  });

  it("許可リストが未設定なら、誰も owner にならない", () => {
    vi.stubEnv("FEATURE_ALLOWED_EMAILS", "");
    expect(subjectFor(session("owner@example.com"), new Headers()).type).toBe("user");
  });
});

describe("bucketsFor(どの枠をまとめて確認するか)", () => {
  it("owner: 自分の枠だけ(全体の予算には数えない)", () => {
    expect(bucketsFor({ type: "owner", userId: "u1" }, limits())).toEqual([
      { key: "u:u1", limit: 100_000 },
    ]);
  });

  it("user: 個人の枠 + 自分以外の全員の合計", () => {
    expect(bucketsFor({ type: "user", userId: "u1" }, limits())).toEqual([
      { key: "u:u1", limit: 30_000 },
      { key: "others:*", limit: 100_000 },
    ]);
  });

  it("anon: IPの枠 + 未ログイン全体 + 自分以外の全員の合計。先頭は常に個人の枠", () => {
    const buckets = bucketsFor({ type: "anon", ip: "198.51.100.7" }, limits());
    expect(buckets).toHaveLength(3);
    expect(buckets[0].key).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(buckets[0].limit).toBe(12_000);
    expect(buckets.slice(1)).toEqual([
      { key: "anon:*", limit: 48_000 },
      { key: "others:*", limit: 100_000 },
    ]);
  });

  it("IPは生のまま保存しない(キーに IP が含まれない)", () => {
    const [ipBucket] = bucketsFor({ type: "anon", ip: "198.51.100.7" }, limits());
    expect(ipBucket.key).not.toContain("198.51.100.7");
  });

  it("同じIPは同じキー、別のIPは別のキーになる", () => {
    const key = (ip: string) => bucketsFor({ type: "anon", ip }, limits())[0].key;
    expect(key("198.51.100.7")).toBe(key("198.51.100.7"));
    expect(key("198.51.100.7")).not.toBe(key("198.51.100.8"));
  });

  it("シークレットが違えば、同じIPでもキーが変わる(ハッシュから元のIPを辿れない)", () => {
    const before = bucketsFor({ type: "anon", ip: "198.51.100.7" }, limits())[0].key;
    vi.stubEnv("BETTER_AUTH_SECRET", "another-secret");
    const after = bucketsFor({ type: "anon", ip: "198.51.100.7" }, limits())[0].key;
    expect(after).not.toBe(before);
  });

  it("シークレットが未設定なら、未ログインの枠は作れず例外になる(IPが無防備に保存されない)", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(() => bucketsFor({ type: "anon", ip: "198.51.100.7" }, limits())).toThrow(
      "BETTER_AUTH_SECRET is not set"
    );
  });

  it("上限は渡された値(環境変数の上書き)に従う", () => {
    vi.stubEnv("USAGE_LIMIT_USER_CHARS", "777");
    expect(bucketsFor({ type: "user", userId: "u1" }, getUsageLimits())[0].limit).toBe(777);
  });
});

describe("nextResetAtIso(次のリセット=次のUTC 0時=日本時間の9時)", () => {
  it.each([
    ["2026-10-15T09:30:00.000Z", "2026-10-16T00:00:00.000Z"],
    ["2026-10-15T23:59:59.999Z", "2026-10-16T00:00:00.000Z"],
    ["2026-10-16T00:00:00.000Z", "2026-10-17T00:00:00.000Z"], // ちょうど0時なら、次の日
    ["2026-10-31T12:00:00.000Z", "2026-11-01T00:00:00.000Z"], // 月末
    ["2026-12-31T12:00:00.000Z", "2027-01-01T00:00:00.000Z"], // 年末
    ["2028-02-28T12:00:00.000Z", "2028-02-29T00:00:00.000Z"], // うるう年
    ["2028-02-29T12:00:00.000Z", "2028-03-01T00:00:00.000Z"],
  ])("%s → %s", (now, expected) => {
    expect(nextResetAtIso(new Date(now))).toBe(expected);
  });

  it("引数なしなら現在時刻を基準にし、結果は常に未来のUTC 0時", () => {
    const next = new Date(nextResetAtIso());
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(next.getUTCHours()).toBe(0);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it("日本時間で表示すると、毎日 9:00 になる", () => {
    expect(formatDateTimeJST(nextResetAtIso(new Date("2026-10-15T09:30:00.000Z")))).toContain("09:00");
    expect(formatDateTimeJST(nextResetAtIso(new Date("2026-10-15T09:30:00.000Z")))).toContain("(JST)");
  });
});

describe("limitMessage(上限を超えたときの案内)", () => {
  it("どの案内にも、リセット時刻のタイムゾーン(JST)が明記される", () => {
    for (const subject of [
      { type: "anon", ip: "x" },
      { type: "user", userId: "u" },
      { type: "owner", userId: "u" },
    ] as const) {
      for (const reason of ["personal", "pool"] as const) {
        expect(limitMessage(subject, reason)).toContain("9:00(JST)");
      }
    }
  });

  it("未ログインの個人の上限には、ログインの案内を出す", () => {
    expect(limitMessage({ type: "anon", ip: "x" }, "personal")).toContain("ログイン");
  });

  it("ログイン済みの個人の上限には、ログインの案内を出さない", () => {
    expect(limitMessage({ type: "user", userId: "u" }, "personal")).not.toContain("ログイン");
  });

  it("busy(DBが混み合って予約できなかった)は、上限超過とは別の文面。リセット時刻やログインの案内は出さない", () => {
    for (const subject of [
      { type: "anon", ip: "x" },
      { type: "user", userId: "u" },
    ] as const) {
      const msg = limitMessage(subject, "busy");
      expect(msg).toContain("アクセスが集中");
      expect(msg).not.toContain("JST");
      expect(msg).not.toContain("ログイン");
    }
  });

  it("全体の上限は、個人の上限とは別の文面にする", () => {
    const pool = limitMessage({ type: "user", userId: "u" }, "pool");
    expect(pool).toContain("全体");
    expect(pool).not.toBe(limitMessage({ type: "user", userId: "u" }, "personal"));
  });
});
