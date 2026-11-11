// 翻訳チケット(Issue #54)の経路を、/api/process・/api/extract・/api/documents でテストする。
// チケットの DB 処理は偽物にし、発行の条件、チケットでの判定、未ログインに戻さないことを確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  return {
    getSession: vi.fn(),
    processChunk: vi.fn(),
    reserveUsage: vi.fn(),
    refundUsage: vi.fn(),
    startTranslation: vi.fn(),
    reserveWithTicket: vi.fn(),
    refundWithTicket: vi.fn(),
    saveDocument: vi.fn(),
    saveDocumentWithTicket: vi.fn(),
    extractTextFromPDF: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm")>()),
  processChunk: mocks.processChunk,
}));
vi.mock("@/lib/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/usage")>()),
  reserveUsage: mocks.reserveUsage,
  refundUsage: mocks.refundUsage,
}));
vi.mock("@/lib/translation-ticket", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/translation-ticket")>()),
  startTranslation: mocks.startTranslation,
  reserveWithTicket: mocks.reserveWithTicket,
  refundWithTicket: mocks.refundWithTicket,
}));
vi.mock("@/lib/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/documents")>()),
  saveDocument: mocks.saveDocument,
  saveDocumentWithTicket: mocks.saveDocumentWithTicket,
}));
vi.mock("@/lib/pdf-parser", () => ({
  extractTextFromPDF: mocks.extractTextFromPDF,
  extractTextFromTXT: (buffer: Buffer) => buffer.toString("utf8"),
}));

import { POST as processPOST } from "@/app/api/process/route";
import { POST as extractPOST } from "@/app/api/extract/route";
import { POST as documentsPOST } from "@/app/api/documents/route";
import { ClaudeResponseError } from "@/lib/llm";

type Handler = (request: NextRequest) => Promise<Response>;

// 引数: ルートの関数、パス、本文、追加ヘッダー / 返り値: 応答(Promise)
const call = (handler: Handler, path: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );

const TICKET = "ticket-abc";
const OWNER = { id: "u-owner", email: "owner@example.com", emailVerified: true };
const USAGE = {
  loggedIn: true,
  capabilities: { tts: true },
  translate: { remaining: 90_000, limit: 100_000, minCharge: 500, constrainedBy: "personal", resetAt: "x" },
};
const RESERVATION = { keys: ["u:u-owner"], day: "2026-11-11", kind: "translate_chars", amount: 500 };
const TICKET_RESERVED = {
  ok: true,
  tokenHash: "hash",
  subject: { type: "owner", userId: "u-owner" },
  reservation: RESERVATION,
};
const DOC = {
  title: "t",
  sourceType: "paste",
  rawText: "Hello.",
  sentences: [{ position: 0, original: "Hello.", translation: "こんにちは。" }],
};

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.stubEnv("FEATURE_ALLOWED_EMAILS", "owner@example.com");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getSession.mockResolvedValue(null);
  mocks.startTranslation.mockResolvedValue({ ok: true, chunks: ["Hello."], usage: USAGE, ticket: TICKET });
  mocks.reserveWithTicket.mockResolvedValue(TICKET_RESERVED);
  mocks.processChunk.mockResolvedValue([{ original: "Hello.", translation: "こんにちは。" }]);
  mocks.saveDocument.mockResolvedValue(1);
  mocks.saveDocumentWithTicket.mockResolvedValue(2);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe("split でのチケットの発行", () => {
  it("withTicket なしは今までどおり。ログインを確かめず、チケットも出さない", async () => {
    const res = await call(processPOST, "/api/process", { action: "split", text: "Hello." });
    const body = await res.json();
    expect(body.chunks).toEqual(["Hello."]);
    expect(body.ticket).toBeUndefined();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.startTranslation).not.toHaveBeenCalled();
  });

  it("withTicket + ログイン中: チャンク・チケット・利用状況を返す", async () => {
    mocks.getSession.mockResolvedValue({ user: OWNER });
    const res = await call(processPOST, "/api/process", { action: "split", text: "Hello.", withTicket: true });
    expect(await res.json()).toEqual({ chunks: ["Hello."], ticket: TICKET, usage: USAGE });
    expect(mocks.startTranslation).toHaveBeenCalledWith("Hello.", OWNER, expect.any(Headers));
  });

  it("withTicket + 未ログイン: チケットを出さず、チャンクだけを返す(今と同じ)", async () => {
    const res = await call(processPOST, "/api/process", { action: "split", text: "Hello.", withTicket: true });
    const body = await res.json();
    expect(body).toEqual({ chunks: ["Hello."] });
    expect(mocks.startTranslation).not.toHaveBeenCalled();
  });

  it("発行で DB が失敗しても、チャンクは返す(チケットと利用状況は null)", async () => {
    mocks.getSession.mockResolvedValue({ user: OWNER });
    mocks.startTranslation.mockRejectedValue(new Error("db down"));
    const res = await call(processPOST, "/api/process", { action: "split", text: "Hello.", withTicket: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ chunks: ["Hello."], ticket: null, usage: null });
  });

  it("本文が長すぎれば 413", async () => {
    mocks.getSession.mockResolvedValue({ user: OWNER });
    mocks.startTranslation.mockResolvedValue({ ok: false, reason: "too_long" });
    const res = await call(processPOST, "/api/process", { action: "split", text: "Hello.", withTicket: true });
    expect(res.status).toBe(413);
  });
});

describe("extract でのチケットの発行", () => {
  const file = { fileName: "a.txt", fileData: Buffer.from("Hello.").toString("base64") };

  it("withTicket なしは今までどおり。本文だけを返し、ログインを確かめない", async () => {
    const res = await call(extractPOST, "/api/extract", file);
    expect(await res.json()).toEqual({ text: "Hello.", fileName: "a.txt" });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("withTicket + ログイン中: 本文に加えて、チャンク・チケット・利用状況を返す", async () => {
    mocks.getSession.mockResolvedValue({ user: OWNER });
    const res = await call(extractPOST, "/api/extract", { ...file, withTicket: true });
    expect(await res.json()).toEqual({
      text: "Hello.",
      fileName: "a.txt",
      chunks: ["Hello."],
      ticket: TICKET,
      usage: USAGE,
    });
  });

  it("PDF では、文字の取り出し(OCR)より前にログインを確かめる", async () => {
    const order: string[] = [];
    mocks.getSession.mockImplementation(async () => {
      order.push("session");
      return { user: OWNER };
    });
    mocks.extractTextFromPDF.mockImplementation(async () => {
      order.push("extract");
      return "Hello.";
    });
    await call(extractPOST, "/api/extract", { fileName: "a.pdf", fileData: "AA==", withTicket: true });
    expect(order).toEqual(["session", "extract"]);
  });

  it("withTicket + 未ログイン: 本文だけを返す", async () => {
    const res = await call(extractPOST, "/api/extract", { ...file, withTicket: true });
    expect(await res.json()).toEqual({ text: "Hello.", fileName: "a.txt" });
    expect(mocks.startTranslation).not.toHaveBeenCalled();
  });
});

describe("translate: チケットでの判定", () => {
  const translate = (headers: Record<string, string>) =>
    call(processPOST, "/api/process", { action: "translate", chunk: "Hello." }, headers);

  it("チケットがあれば、セッションを見ずに、チケットで予約して翻訳する", async () => {
    const res = await translate({ "x-translation-ticket": TICKET });
    expect(res.status).toBe(200);
    expect(mocks.reserveWithTicket).toHaveBeenCalledWith(TICKET, "Hello.");
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.reserveUsage).not.toHaveBeenCalled();
  });

  it("チケットが無効なら 401 + ticket_invalid。未ログインに戻して翻訳しない", async () => {
    mocks.reserveWithTicket.mockResolvedValue({ ok: false, reason: "ticket_invalid" });
    const res = await translate({ "x-translation-ticket": TICKET });
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("ticket_invalid");
    expect(mocks.reserveUsage).not.toHaveBeenCalled();
    expect(mocks.processChunk).not.toHaveBeenCalled();
  });

  it("空のチケットのヘッダーも、無効なチケットとして扱う(未ログインに戻さない)", async () => {
    mocks.reserveWithTicket.mockResolvedValue({ ok: false, reason: "ticket_invalid" });
    const res = await translate({ "x-translation-ticket": "" });
    expect(res.status).toBe(401);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("持ち主の上限に達したら 429。文面はログイン済みの上限のもの", async () => {
    mocks.reserveWithTicket.mockResolvedValue({
      ok: false,
      reason: "personal",
      subject: { type: "user", userId: "u1" },
    });
    const res = await translate({ "x-translation-ticket": TICKET });
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.reason).toBe("personal");
    expect(body.error).not.toContain("未ログイン");
  });

  it("DB が混み合っていれば 429(busy)", async () => {
    mocks.reserveWithTicket.mockResolvedValue({ ok: false, reason: "busy" });
    const res = await translate({ "x-translation-ticket": TICKET });
    expect(res.status).toBe(429);
    expect((await res.json()).reason).toBe("busy");
  });

  it("Claude が失敗したら、チケット側も含めて返金する", async () => {
    mocks.processChunk.mockRejectedValue(new Error("network"));
    const res = await translate({ "x-translation-ticket": TICKET });
    expect(res.status).toBe(500);
    expect(mocks.refundWithTicket).toHaveBeenCalledWith(TICKET_RESERVED);
    expect(mocks.refundUsage).not.toHaveBeenCalled();
  });

  it("Claude が応答した後の失敗は、課金済みなので返金しない", async () => {
    mocks.processChunk.mockRejectedValue(new ClaudeResponseError("bad"));
    await translate({ "x-translation-ticket": TICKET });
    expect(mocks.refundWithTicket).not.toHaveBeenCalled();
  });
});

describe("documents: チケットでの保存", () => {
  const save = (body: unknown, headers: Record<string, string> = {}) =>
    call(documentsPOST, "/api/documents", body, headers);

  it("チケットがあれば、セッションを見ずに、チケットで保存する", async () => {
    const res = await save(DOC, { "x-translation-ticket": TICKET });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 2 });
    expect(mocks.saveDocumentWithTicket).toHaveBeenCalledWith(TICKET, DOC);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.saveDocument).not.toHaveBeenCalled();
  });

  it("チケットが使えなければ 401 + ticket_invalid", async () => {
    mocks.saveDocumentWithTicket.mockResolvedValue(null);
    const res = await save(DOC, { "x-translation-ticket": TICKET });
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("ticket_invalid");
  });

  it("チケットがなく、未ログインなら 401(今までどおり)", async () => {
    const res = await save(DOC);
    expect(res.status).toBe(401);
    expect(mocks.saveDocument).not.toHaveBeenCalled();
  });

  it("チケットがなく、ログイン中ならセッションのユーザーで保存する(今までどおり)", async () => {
    mocks.getSession.mockResolvedValue({ user: OWNER });
    const res = await save(DOC);
    expect(await res.json()).toEqual({ id: 1 });
    expect(mocks.saveDocument).toHaveBeenCalledWith({ ...DOC, userId: "u-owner" });
  });

  it.each([
    ["例文が多すぎる", { ...DOC, sentences: Array(10_001).fill(DOC.sentences[0]) }],
    ["原文が長すぎる", { ...DOC, sentences: [{ ...DOC.sentences[0], original: "a".repeat(2_001) }] }],
    ["訳文が長すぎる", { ...DOC, sentences: [{ ...DOC.sentences[0], translation: "あ".repeat(4_001) }] }],
  ])("%s と 400。保存しない", async (_label, body) => {
    const res = await save(body, { "x-translation-ticket": TICKET });
    expect(res.status).toBe(400);
    expect(mocks.saveDocumentWithTicket).not.toHaveBeenCalled();
  });
});
