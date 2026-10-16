import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), generateSpeech: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/elevenlabs", () => ({ generateSpeech: mocks.generateSpeech }));

import { POST } from "@/app/api/tts/route";

const call = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const user = (email: string, emailVerified = true) => ({ user: { id: "u1", email, emailVerified } });

beforeEach(() => {
  vi.stubEnv("FEATURE_ALLOWED_EMAILS", "owner@example.com");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.generateSpeech.mockResolvedValue("data:audio/mpeg;base64,AAAA");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe("POST /api/tts(試験導入: 許可リストのアカウントだけ)", () => {
  it("未ログインは 401。ElevenLabs を呼ばない", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await call({ text: "Hello." });
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("login_required");
    expect(mocks.generateSpeech).not.toHaveBeenCalled();
  });

  it("ログイン済みでも許可リスト外は 403。ElevenLabs を呼ばない", async () => {
    mocks.getSession.mockResolvedValue(user("other@example.com"));
    const res = await call({ text: "Hello." });
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("not_allowed");
    expect(mocks.generateSpeech).not.toHaveBeenCalled();
  });

  it("許可リストに入っていても、メール未確認なら 403", async () => {
    mocks.getSession.mockResolvedValue(user("owner@example.com", false));
    expect((await call({ text: "Hello." })).status).toBe(403);
    expect(mocks.generateSpeech).not.toHaveBeenCalled();
  });

  it("許可リストが未設定なら、自分のアカウントでも 403(安全側)", async () => {
    vi.stubEnv("FEATURE_ALLOWED_EMAILS", "");
    mocks.getSession.mockResolvedValue(user("owner@example.com"));
    expect((await call({ text: "Hello." })).status).toBe(403);
  });

  it("許可リストのアカウントは 200 で音声を受け取れる", async () => {
    mocks.getSession.mockResolvedValue(user("owner@example.com"));
    const res = await call({ text: "Hello." });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ audioUrl: "data:audio/mpeg;base64,AAAA" });
    expect(mocks.generateSpeech).toHaveBeenCalledWith("Hello.");
  });

  it("許可されていても、text がなければ 400", async () => {
    mocks.getSession.mockResolvedValue(user("owner@example.com"));
    expect((await call({})).status).toBe(400);
    expect((await call({ text: 5 })).status).toBe(400);
    expect(mocks.generateSpeech).not.toHaveBeenCalled();
  });

  it("ElevenLabs が失敗したら 500(内部のエラーは返さない)", async () => {
    mocks.getSession.mockResolvedValue(user("owner@example.com"));
    mocks.generateSpeech.mockRejectedValue(new Error("secret internal detail"));
    const res = await call({ text: "Hello." });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret internal detail");
  });

  it("セッションの取得に失敗したら、ElevenLabs を呼ばずに 500", async () => {
    mocks.getSession.mockRejectedValue(new Error("auth down"));
    expect((await call({ text: "Hello." })).status).toBe(500);
    expect(mocks.generateSpeech).not.toHaveBeenCalled();
  });

  it("応答に、許可リストの内容を含めない", async () => {
    mocks.getSession.mockResolvedValue(user("other@example.com"));
    const body = JSON.stringify(await (await call({ text: "Hello." })).json());
    expect(body).not.toContain("owner@example.com");
  });
});
