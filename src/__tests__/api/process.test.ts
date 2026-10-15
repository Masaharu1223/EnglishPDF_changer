import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// 認証・Claude・使用量(DB)は偽物に差し替える。確かめたいのは、窓口(APIルート)が
// 「どの順番で・何を呼び・何を返すか」だけ。DBの動きは integration/ で本物を使って確かめる。
const mocks = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-key"; // llm.ts が読み込み時に Anthropic クライアントを作るため
  return {
    getSession: vi.fn(),
    processChunk: vi.fn(),
    reserveUsage: vi.fn(),
    refundUsage: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm")>()),
  processChunk: mocks.processChunk,
}));
vi.mock("@/lib/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/usage")>()),
  reserveUsage: mocks.reserveUsage,
  refundUsage: mocks.refundUsage,
}));

import { POST } from "@/app/api/process/route";

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost/api/process", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );

const RESERVATION = { keys: ["u:x"], day: "2026-10-15", kind: "translate_chars", amount: 10 };

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.stubEnv("FEATURE_ALLOWED_EMAILS", "owner@example.com");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getSession.mockResolvedValue(null); // 既定は未ログイン
  mocks.reserveUsage.mockResolvedValue({ ok: true, reservation: RESERVATION });
  mocks.processChunk.mockResolvedValue([{ original: "Hi.", translation: "やあ。" }]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe("POST /api/process: split", () => {
  it("テキストをチャンクに分けて返す。使用量には触れない(Claudeを呼ばないため)", async () => {
    const res = await call({ action: "split", text: "Hello there. How are you?" });
    expect(res.status).toBe(200);
    expect((await res.json()).chunks.length).toBeGreaterThan(0);
    expect(mocks.reserveUsage).not.toHaveBeenCalled();
    expect(mocks.processChunk).not.toHaveBeenCalled();
  });

  it.each([{ action: "split" }, { action: "split", text: "" }, { action: "split", text: 123 }])(
    "テキストがなければ 400: %j",
    async (body) => {
      expect((await call(body)).status).toBe(400);
    }
  );
});

describe("POST /api/process: translate の入力チェック", () => {
  it.each([{ action: "translate" }, { action: "translate", chunk: "" }, { action: "translate", chunk: 42 }])(
    "chunk がなければ 400: %j",
    async (body) => {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(mocks.reserveUsage).not.toHaveBeenCalled();
    }
  );

  it("上限(2,000文字)を超えるchunkは 413。使用量にもClaudeにも触れない", async () => {
    const res = await call({ action: "translate", chunk: "a".repeat(2001) });
    expect(res.status).toBe(413);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.reserveUsage).not.toHaveBeenCalled();
    expect(mocks.processChunk).not.toHaveBeenCalled();
  });

  it("上限ちょうど(2,000文字)は受け付ける", async () => {
    const res = await call({ action: "translate", chunk: "a".repeat(2000) });
    expect(res.status).toBe(200);
  });

  it("環境変数で、受け付ける最大文字数を変えられる", async () => {
    vi.stubEnv("MAX_TRANSLATE_CHUNK_CHARS", "10");
    expect((await call({ action: "translate", chunk: "a".repeat(11) })).status).toBe(413);
    expect((await call({ action: "translate", chunk: "a".repeat(10) })).status).toBe(200);
  });
});

describe("POST /api/process: translate 予約 → Claude の順序", () => {
  it("予約できたらClaudeを1回だけ呼び、結果を返す。返却はしない", async () => {
    const res = await call({ action: "translate", chunk: "Hello." });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sentences: [{ original: "Hi.", translation: "やあ。" }] });
    expect(mocks.processChunk).toHaveBeenCalledTimes(1);
    expect(mocks.processChunk).toHaveBeenCalledWith("Hello.");
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it("予約する量は、chunk の文字数そのもの", async () => {
    await call({ action: "translate", chunk: "Hello." });
    expect(mocks.reserveUsage).toHaveBeenCalledWith(expect.anything(), "translate_chars", 6);
  });

  it("予約が、Claudeを呼ぶより先に行われる", async () => {
    const order: string[] = [];
    mocks.reserveUsage.mockImplementation(async () => {
      order.push("reserve");
      return { ok: true, reservation: RESERVATION };
    });
    mocks.processChunk.mockImplementation(async () => {
      order.push("claude");
      return [];
    });
    await call({ action: "translate", chunk: "Hello." });
    expect(order).toEqual(["reserve", "claude"]);
  });

  it("Claudeが失敗したら、予約した分を返却して 500 を返す", async () => {
    mocks.processChunk.mockRejectedValue(new Error("boom"));
    const res = await call({ action: "translate", chunk: "Hello." });
    expect(res.status).toBe(500);
    expect(mocks.refundUsage).toHaveBeenCalledTimes(1);
    expect(mocks.refundUsage).toHaveBeenCalledWith(RESERVATION);
  });

  it("エラーの詳細(内部のメッセージ)を応答に含めない", async () => {
    mocks.processChunk.mockRejectedValue(new Error("secret internal detail"));
    const body = JSON.stringify(await (await call({ action: "translate", chunk: "Hello." })).json());
    expect(body).not.toContain("secret internal detail");
  });

  it("使用量のDBが失敗したら、Claudeを呼ばずに 500(使い放題にならない)", async () => {
    mocks.reserveUsage.mockRejectedValue(new Error("db down"));
    const res = await call({ action: "translate", chunk: "Hello." });
    expect(res.status).toBe(500);
    expect(mocks.processChunk).not.toHaveBeenCalled();
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it("セッションの取得に失敗したら、Claudeを呼ばずに 500", async () => {
    mocks.getSession.mockRejectedValue(new Error("auth down"));
    const res = await call({ action: "translate", chunk: "Hello." });
    expect(res.status).toBe(500);
    expect(mocks.processChunk).not.toHaveBeenCalled();
  });
});

describe("POST /api/process: 上限を超えたとき(429)", () => {
  it("個人の上限: 429 と、案内・理由・リセット時刻・Retry-After を返す。Claudeは呼ばない", async () => {
    mocks.reserveUsage.mockResolvedValue({ ok: false, reason: "personal" });
    const res = await call({ action: "translate", chunk: "Hello." });
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.reason).toBe("personal");
    expect(body.error).toContain("9:00(JST)");
    expect(body.error).toContain("ログイン"); // 未ログインなので、ログインの案内つき
    expect(new Date(body.resetAt).toISOString()).toBe(body.resetAt); // ISO 8601
    expect(new Date(body.resetAt).getTime()).toBeGreaterThan(Date.now());

    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(24 * 60 * 60);

    expect(mocks.processChunk).not.toHaveBeenCalled();
    expect(mocks.refundUsage).not.toHaveBeenCalled(); // 予約できていないので、返却するものがない
  });

  it("全体の上限: reason は pool で、文面が個人の上限と異なる", async () => {
    mocks.reserveUsage.mockResolvedValue({ ok: false, reason: "pool" });
    const body = await (await call({ action: "translate", chunk: "Hello." })).json();
    expect(body.reason).toBe("pool");
    expect(body.error).toContain("全体");
  });

  it("ログイン済みの個人の上限には、ログインの案内を出さない", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u1", email: "a@x.com", emailVerified: true } });
    mocks.reserveUsage.mockResolvedValue({ ok: false, reason: "personal" });
    const body = await (await call({ action: "translate", chunk: "Hello." })).json();
    expect(body.error).not.toContain("ログイン");
  });
});

describe("POST /api/process: 誰の使用量として数えるか", () => {
  it("未ログイン: anon として、リクエストのIPを渡す", async () => {
    await call({ action: "translate", chunk: "Hello." }, { "x-forwarded-for": "198.51.100.7" });
    expect(mocks.reserveUsage.mock.calls[0][0]).toEqual({ type: "anon", ip: "198.51.100.7" });
  });

  it("ログイン済み(許可リスト外): user", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u1", email: "a@x.com", emailVerified: true } });
    await call({ action: "translate", chunk: "Hello." });
    expect(mocks.reserveUsage.mock.calls[0][0]).toEqual({ type: "user", userId: "u1" });
  });

  it("許可リストのアカウント: owner", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u2", email: "owner@example.com", emailVerified: true } });
    await call({ action: "translate", chunk: "Hello." });
    expect(mocks.reserveUsage.mock.calls[0][0]).toEqual({ type: "owner", userId: "u2" });
  });
});

describe("POST /api/process: 閉じた経路", () => {
  it("旧経路(action なし)は 400。Claudeを呼ばない", async () => {
    const res = await call({ text: "Hello world." });
    expect(res.status).toBe(400);
    expect(mocks.processChunk).not.toHaveBeenCalled();
    expect(mocks.reserveUsage).not.toHaveBeenCalled();
  });

  it("不明な action は 400", async () => {
    expect((await call({ action: "x" })).status).toBe(400);
  });
});
