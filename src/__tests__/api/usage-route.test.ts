import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), getRemainingUsage: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/usage")>()),
  getRemainingUsage: mocks.getRemainingUsage,
}));

import { GET, dynamic } from "@/app/api/usage/route";

const call = (headers: Record<string, string> = {}) =>
  GET(new NextRequest("http://localhost/api/usage", { headers }));

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.stubEnv("FEATURE_ALLOWED_EMAILS", "owner@example.com");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getSession.mockResolvedValue(null);
  mocks.getRemainingUsage.mockResolvedValue({ remaining: 8_000, limit: 12_000, constrainedBy: "personal" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe("GET /api/usage(画面に残量を出すための読み取り専用API)", () => {
  it("未ログイン: 残量・上限・リセット時刻を返し、音声は使えない", async () => {
    const res = await call({ "x-forwarded-for": "198.51.100.7" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.loggedIn).toBe(false);
    expect(body.capabilities).toEqual({ tts: false });
    expect(body.translate).toMatchObject({ remaining: 8_000, limit: 12_000, constrainedBy: "personal" });
    expect(new Date(body.translate.resetAt).toISOString()).toBe(body.translate.resetAt);
  });

  it("未ログインの主体(IPつき)で、翻訳の残量を問い合わせる", async () => {
    await call({ "x-forwarded-for": "198.51.100.7" });
    expect(mocks.getRemainingUsage).toHaveBeenCalledWith(
      { type: "anon", ip: "198.51.100.7" },
      "translate_chars"
    );
  });

  it("ログイン済み(許可リスト外): loggedIn は true、音声は使えない", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u1", email: "a@x.com", emailVerified: true } });
    const body = await (await call()).json();
    expect(body.loggedIn).toBe(true);
    expect(body.capabilities.tts).toBe(false);
  });

  it("許可リストのアカウント: 音声を使える", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u2", email: "owner@example.com", emailVerified: true } });
    expect((await (await call()).json()).capabilities.tts).toBe(true);
  });

  it("許可リストのメールアドレスを、応答に含めない", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u2", email: "owner@example.com", emailVerified: true } });
    expect(JSON.stringify(await (await call()).json())).not.toContain("owner@example.com");
  });

  it("キャッシュさせない(残量が古くならないように)", async () => {
    expect((await call()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("ビルド時に静的評価されない(dynamic = force-dynamic)", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("残量の取得に失敗したら 500(内部のエラーは返さない)", async () => {
    mocks.getRemainingUsage.mockRejectedValue(new Error("secret internal detail"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret internal detail");
  });
});
