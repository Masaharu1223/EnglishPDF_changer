// POST /api/translations(本文を1回で受け取り、サーバーで最後まで翻訳する API)をテストする。
// 認証・翻訳の関数・保存・PDF の読み取り・after は偽物にし、返事の種類、流す知らせの順番、保存の条件を確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { RunInput, RunResult } from "@/lib/translation-run";

const mocks = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  return {
    getSession: vi.fn(),
    runTranslation: vi.fn(),
    saveDocument: vi.fn(),
    extractTextFromPDF: vi.fn(),
    afterTasks: [] as Promise<unknown>[],
  };
});

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: Promise<unknown>) => {
    mocks.afterTasks.push(task);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/translation-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/translation-run")>()),
  runTranslation: mocks.runTranslation,
}));
vi.mock("@/lib/documents", () => ({ saveDocument: mocks.saveDocument }));
vi.mock("@/lib/pdf-parser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pdf-parser")>()),
  extractTextFromPDF: mocks.extractTextFromPDF,
}));

import { POST } from "@/app/api/translations/route";

const TEXT = "Hello there. How are you? I am fine.";
const SESSION = { user: { id: "u1", email: "user@example.com", emailVerified: true } };

// 引数: リクエスト本文, 追加ヘッダー(省略可) / 返り値: POST ルートの応答(Promise)
const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost/api/translations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

// 引数: 応答 / 返り値: NDJSON を1行ずつ JSON にした配列(after の処理が終わるまで待つ)
const readEvents = async (res: Response) => {
  const text = await res.text();
  await Promise.all(mocks.afterTasks);
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
};

// 引数: 上書きする結果 / 返り値: 予約が成功したあとの翻訳の結果
const okResult = (over: Partial<Extract<RunResult, { ok: true }>> = {}): RunResult => ({
  ok: true,
  status: "complete",
  sentences: [
    { original: "Hello there.", translation: "こんにちは。" },
    { original: "How are you?", translation: "元気?" },
  ],
  failedChunks: 0,
  notProcessed: 0,
  ...over,
});

// 引数: 返す結果 / 返り値: 予約できたことを知らせ、チャンクごとに onChunk を呼んでから結果を返す偽物
const runsTo = (result: RunResult) => async (input: RunInput) => {
  input.onReserved?.();
  for (let i = 0; i < input.chunks.length; i++) await input.onChunk(i, []);
  return result;
};

// 引数: なし / 返り値: 外から解決できる Promise
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.stubEnv("FEATURE_ALLOWED_EMAILS", "owner@example.com");
  vi.stubEnv("USAGE_MIN_CHARGE_CHARS", "500");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.afterTasks.length = 0;
  mocks.getSession.mockResolvedValue(null);
  mocks.runTranslation.mockImplementation(runsTo(okResult()));
  mocks.saveDocument.mockResolvedValue(42);
  mocks.extractTextFromPDF.mockResolvedValue(TEXT);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.getSession.mockReset();
  mocks.runTranslation.mockReset();
  mocks.saveDocument.mockReset();
  mocks.extractTextFromPDF.mockReset();
});

describe("入力の確認(400)", () => {
  it.each([
    ["JSON でない", "not json"],
    ["題名がない", { text: TEXT }],
    ["題名が空", { title: "", text: TEXT }],
    ["題名が長すぎる", { title: "a".repeat(201), text: TEXT }],
    ["本文もファイルもない", { title: "t" }],
    ["本文が文字列でない", { title: "t", text: 123 }],
    ["対応していないファイル", { title: "t", fileName: "a.docx", fileData: "AAAA" }],
    ["本文が空白だけ", { title: "t", text: "   \n " }],
  ])("%s: 400。翻訳を始めない", async (_label, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(mocks.runTranslation).not.toHaveBeenCalled();
  });
});

describe("長すぎる文章(413)", () => {
  it("整えた本文が 30,000 字を超えたら 413。予約の前なので、翻訳の関数を呼ばない", async () => {
    const res = await call({ title: "t", text: `${"a".repeat(30_001)}` });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ reason: "too_long", maxChars: 30_000 });
    expect(mocks.runTranslation).not.toHaveBeenCalled();
  });

  it("ちょうど 30,000 字なら受け付ける", async () => {
    const res = await call({ title: "t", text: "a".repeat(30_000) });
    expect(res.status).toBe(200);
    await readEvents(res);
  });

  it("前後の空白は数えない(整えたあとの長さで判断する)", async () => {
    const res = await call({ title: "t", text: `   ${"a".repeat(30_000)}   ` });
    expect(res.status).toBe(200);
    await readEvents(res);
  });
});

describe("使用量の上限(429)", () => {
  it.each(["personal", "pool"] as const)(
    "%s: 429 と、理由・リセット時刻・必要な文字数を返す。after に渡した約束もすぐ終わる",
    async (reason) => {
      mocks.runTranslation.mockResolvedValue({ ok: false, reason });
      const res = await call({ title: "t", text: TEXT });
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).not.toBeNull();
      const body = await res.json();
      expect(body).toMatchObject({ reason, required: 500 });
      expect(body.resetAt).toEqual(expect.any(String));
      expect(mocks.afterTasks).toHaveLength(1);
      await Promise.all(mocks.afterTasks);
    }
  );

  it("混み合い(busy): 429 で、リセット時刻は返さない", async () => {
    mocks.runTranslation.mockResolvedValue({ ok: false, reason: "busy" });
    const res = await call({ title: "t", text: TEXT });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.reason).toBe("busy");
    expect(body.resetAt).toBeUndefined();
  });

  it("予約の前に例外が出たら(DB に届かないなど)500。中身は返さない", async () => {
    mocks.runTranslation.mockRejectedValue(new Error("db down: secret detail"));
    const res = await call({ title: "t", text: TEXT });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
    await Promise.all(mocks.afterTasks);
  });
});

describe("200 で流す知らせ", () => {
  it("ヘッダーは NDJSON でキャッシュしない。start → progress → done の順に流す", async () => {
    const text = "Sentence one. ".repeat(200);
    const res = await call({ title: "t", text });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");

    const events = await readEvents(res);
    const total = mocks.runTranslation.mock.calls[0][0].chunks.length;
    expect(total).toBeGreaterThan(1);
    expect(events[0]).toEqual({ type: "start", totalChunks: total });
    expect(events.slice(1, -1)).toEqual(
      Array.from({ length: total }, (_, i) => ({
        type: "progress",
        completedChunks: i + 1,
        totalChunks: total,
      }))
    );
    expect(events.at(-1)).toMatchObject({ type: "done", status: "complete" });
  });

  it("done に、全部の文と結果をまとめて入れる", async () => {
    const result = okResult({ status: "failed", failedChunks: 1, notProcessed: 0 });
    mocks.runTranslation.mockImplementation(runsTo(result));
    const events = await readEvents(await call({ title: "t", text: TEXT }));
    expect(events.at(-1)).toEqual({
      type: "done",
      status: "failed",
      sentences: result.ok ? result.sentences : [],
      failedChunks: 1,
      notProcessed: 0,
      documentId: null,
      saveFailed: false,
    });
  });

  it("after への登録は1回だけで、done を送ったら終わる", async () => {
    const res = await call({ title: "t", text: TEXT });
    expect(mocks.afterTasks).toHaveLength(1);
    await readEvents(res);
  });

  it("予約の直後に progress が来ても、start が必ず先に並ぶ", async () => {
    mocks.runTranslation.mockImplementation(async (input: RunInput) => {
      input.onReserved?.();
      input.onChunk(0, []);
      return okResult();
    });
    const types = (await readEvents(await call({ title: "t", text: TEXT }))).map((e) => e.type);
    expect(types).toEqual(["start", "progress", "done"]);
  });

  it("予約せずに結果が返っても(締め切りを過ぎていたなど)、start を1回だけ送ってから done を送る", async () => {
    mocks.runTranslation.mockResolvedValue(okResult({ status: "incomplete", sentences: [], notProcessed: 1 }));
    const types = (await readEvents(await call({ title: "t", text: TEXT }))).map((e) => e.type);
    expect(types).toEqual(["start", "done"]);
  });

  it("予約の後に想定外の例外が出たら、error を流して閉じる。内部のメッセージは出さない", async () => {
    mocks.runTranslation.mockImplementation(async (input: RunInput) => {
      input.onReserved?.();
      throw new Error("secret detail");
    });
    const events = await readEvents(await call({ title: "t", text: TEXT }));
    expect(events.map((e) => e.type)).toEqual(["start", "error"]);
    expect(JSON.stringify(events)).not.toContain("secret detail");
  });

  it("何も送らない時間が15秒続いたら ping を送る", async () => {
    vi.useFakeTimers();
    const gate = deferred<RunResult>();
    mocks.runTranslation.mockImplementation(async (input: RunInput) => {
      input.onReserved?.();
      return gate.promise;
    });
    const res = await call({ title: "t", text: TEXT });
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    gate.resolve(okResult());
    await vi.advanceTimersByTimeAsync(0);
    const types = (await readEvents(res)).map((e) => e.type);
    expect(types).toEqual(["start", "ping", "done"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("予約で断ったときも、ハートビートのタイマーを残さない", async () => {
    vi.useFakeTimers();
    mocks.runTranslation.mockResolvedValue({ ok: false, reason: "personal" });
    const res = await call({ title: "t", text: TEXT });
    expect(res.status).toBe(429);
    await Promise.all(mocks.afterTasks);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("締め切りと、使用量を数える相手", () => {
  it("締め切りは受付の時刻 + 240秒。PDF の読み取りにかかった時間も含める", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.extractTextFromPDF.mockImplementation(async () => {
      now += 30_000;
      return TEXT;
    });
    const res = await call({ title: "t", fileName: "a.pdf", fileData: "AAAA" });
    await readEvents(res);
    expect(mocks.runTranslation.mock.calls[0][0].deadlineAt).toBe(1_000_000 + 240_000);
  });

  it("未ログイン: IP で数える", async () => {
    await readEvents(await call({ title: "t", text: TEXT }));
    expect(mocks.runTranslation.mock.calls[0][0].subject).toEqual({ type: "anon", ip: "203.0.113.5" });
  });

  it("ログイン中: そのユーザーで数える。ログインの確認は1回だけ", async () => {
    mocks.getSession.mockResolvedValue(SESSION);
    await readEvents(await call({ title: "t", text: TEXT }));
    expect(mocks.runTranslation.mock.calls[0][0].subject).toEqual({ type: "user", userId: "u1" });
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });
});

describe("ファイルの入力", () => {
  it("TXT: base64 を読んで翻訳し、入力の種類は txt で保存する", async () => {
    mocks.getSession.mockResolvedValue(SESSION);
    const fileData = Buffer.from(TEXT, "utf-8").toString("base64");
    await readEvents(await call({ title: "a.txt", fileName: "A.TXT", fileData }));
    expect(mocks.runTranslation.mock.calls[0][0].chunks.join(" ")).toContain("Hello there.");
    expect(mocks.saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: "txt", rawText: TEXT })
    );
  });

  it("PDF: PDF の読み取りを使い、入力の種類は pdf で保存する", async () => {
    mocks.getSession.mockResolvedValue(SESSION);
    await readEvents(await call({ title: "a.pdf", fileName: "a.pdf", fileData: "AAAA" }));
    expect(mocks.extractTextFromPDF).toHaveBeenCalledTimes(1);
    expect(mocks.saveDocument).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "pdf" }));
  });

  it("壊れたファイルで読み取りに失敗したら 400(何度やり直しても同じなので 500 にしない)", async () => {
    mocks.extractTextFromPDF.mockRejectedValue(new Error("bad pdf"));
    const res = await call({ title: "a.pdf", fileName: "a.pdf", fileData: "AAAA" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Could not read the file." });
    expect(mocks.runTranslation).not.toHaveBeenCalled();
  });

  it("PDF から文字が取れなかったら 400", async () => {
    mocks.extractTextFromPDF.mockResolvedValue("  ");
    const res = await call({ title: "a.pdf", fileName: "a.pdf", fileData: "AAAA" });
    expect(res.status).toBe(400);
    expect(mocks.runTranslation).not.toHaveBeenCalled();
  });
});

describe("履歴への保存", () => {
  it("ログイン中で最後まで終わったら保存し、done に教材の id を入れる", async () => {
    mocks.getSession.mockResolvedValue(SESSION);
    const events = await readEvents(await call({ title: "My title", text: TEXT }));
    expect(mocks.saveDocument).toHaveBeenCalledWith({
      userId: "u1",
      title: "My title",
      sourceType: "paste",
      rawText: TEXT,
      sentences: [
        { position: 0, original: "Hello there.", translation: "こんにちは。" },
        { position: 1, original: "How are you?", translation: "元気?" },
      ],
    });
    expect(events.at(-1)).toMatchObject({ documentId: 42, saveFailed: false });
  });

  it("未ログインなら保存しない", async () => {
    const events = await readEvents(await call({ title: "t", text: TEXT }));
    expect(mocks.saveDocument).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ documentId: null, saveFailed: false });
  });

  it.each(["incomplete", "failed", "aborted"] as const)("最後まで終わらなければ(%s)保存しない", async (status) => {
    mocks.getSession.mockResolvedValue(SESSION);
    mocks.runTranslation.mockImplementation(runsTo(okResult({ status })));
    await readEvents(await call({ title: "t", text: TEXT }));
    expect(mocks.saveDocument).not.toHaveBeenCalled();
  });

  it("文が1つもなければ保存しない", async () => {
    mocks.getSession.mockResolvedValue(SESSION);
    mocks.runTranslation.mockImplementation(runsTo(okResult({ sentences: [] })));
    await readEvents(await call({ title: "t", text: TEXT }));
    expect(mocks.saveDocument).not.toHaveBeenCalled();
  });

  it("保存に失敗しても、done は送る(saveFailed: true)", async () => {
    mocks.getSession.mockResolvedValue(SESSION);
    mocks.saveDocument.mockRejectedValue(new Error("db down"));
    const events = await readEvents(await call({ title: "t", text: TEXT }));
    expect(events.at(-1)).toMatchObject({ type: "done", documentId: null, saveFailed: true });
  });

  it("文が保存の上限を超えていたら、保存せずに saveFailed: true", async () => {
    mocks.getSession.mockResolvedValue(SESSION);
    mocks.runTranslation.mockImplementation(
      runsTo(okResult({ sentences: [{ original: "a".repeat(2_001), translation: "訳" }] }))
    );
    const events = await readEvents(await call({ title: "t", text: TEXT }));
    expect(mocks.saveDocument).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ saveFailed: true });
  });

  it("翻訳チケットのヘッダーは見ない(セッションで保存先を決める)", async () => {
    await readEvents(await call({ title: "t", text: TEXT }, { "x-translation-ticket": "anything" }));
    expect(mocks.saveDocument).not.toHaveBeenCalled();
  });
});

describe("画面との通信が切れたとき", () => {
  it("読むのをやめても(通信が切れても)、翻訳と保存は最後まで進み、例外にならない", async () => {
    mocks.getSession.mockResolvedValue(SESSION);
    const gate = deferred<void>();
    mocks.runTranslation.mockImplementation(async (input: RunInput) => {
      input.onReserved?.();
      await gate.promise;
      for (let i = 0; i < input.chunks.length; i++) await input.onChunk(i, []);
      return okResult();
    });
    const res = await call({ title: "t", text: TEXT });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();

    gate.resolve();
    await Promise.all(mocks.afterTasks);
    expect(mocks.saveDocument).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalledWith("Translation stream error:", expect.anything());
  });
});
