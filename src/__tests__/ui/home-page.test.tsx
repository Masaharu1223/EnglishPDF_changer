// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UsageInfo } from "@/types";

const mocks = vi.hoisted(() => ({
  session: { data: null as null | { user: { id: string } } },
  usage: null as UsageInfo | null,
  refresh: vi.fn(),
  fetchUsage: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: mocks.session.data, isPending: false }),
}));
vi.mock("@/components/UsageProvider", () => ({
  useUsage: () => ({ usage: mocks.usage, refresh: mocks.refresh }),
  fetchUsage: mocks.fetchUsage,
}));

import Home from "@/app/page";

// ---- /api/* の偽物。呼ばれた内容を記録し、応答はテストごとに差し替える ----
type Call = { url: string; body: Record<string, unknown> };
let calls: Call[];
let chunks: string[];
let translateCount: number;
let translateHandler: (n: number, chunk: string) => Response;
let documentsHandler: () => Response;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const translated = (n: number) =>
  json({ sentences: [{ original: `Sentence ${n}.`, translation: `文${n}。` }] });
const limitReached = () =>
  json({ error: "本日の利用上限に達しました。上限は毎日 9:00(JST)にリセットされます。", reason: "personal" }, 429);

const usage = (remaining: number): UsageInfo => ({
  loggedIn: false,
  capabilities: { tts: false },
  translate: { remaining, limit: 12_000, minCharge: 500, constrainedBy: "personal", resetAt: "2026-10-16T00:00:00.000Z" },
});

const callsTo = (url: string, action?: string) =>
  calls.filter((c) => c.url === url && (action === undefined || c.body?.action === action));

beforeEach(() => {
  calls = [];
  chunks = ["Chunk one.", "Chunk two.", "Chunk three."];
  translateCount = 0;
  translateHandler = (n) => translated(n);
  documentsHandler = () => json({ id: 1 });
  mocks.session.data = null;
  mocks.usage = null;
  mocks.fetchUsage.mockResolvedValue(null); // 既定は「取得できない」=事前チェックを省く
  mocks.refresh.mockResolvedValue(null);
  sessionStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      calls.push({ url, body });
      if (url === "/api/process" && body.action === "split") return json({ chunks });
      if (url === "/api/process" && body.action === "translate") {
        translateCount += 1;
        return translateHandler(translateCount, body.chunk);
      }
      if (url === "/api/documents") return documentsHandler();
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.fetchUsage.mockReset();
  mocks.refresh.mockReset();
});

const TEXT = "Hello there. This is a sample text.";
const submit = (text = TEXT) => {
  fireEvent.click(screen.getByRole("button", { name: "テキストを貼り付け" }));
  fireEvent.change(screen.getByPlaceholderText(/英文をここに貼り付けてください/), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "このテキストを処理する" }));
};

describe("ホーム画面: 翻訳を始める前の警告", () => {
  it("文書が今日の残りを超えるなら、翻訳を始めずに警告する(途中で止まる中途半端な結果を避ける)", async () => {
    chunks = ["a".repeat(200)];
    mocks.fetchUsage.mockResolvedValue(usage(100));
    render(<Home />);
    submit();

    expect(await screen.findByText(/翻訳を始めませんでした/)).toBeTruthy();
    expect(callsTo("/api/process", "translate")).toHaveLength(0);
    expect(callsTo("/api/documents")).toHaveLength(0);
    expect(mocks.refresh).toHaveBeenCalled(); // 残りの表示を最新にする
  });

  it("警告には、文書の文字数と残りの文字数が出る", async () => {
    chunks = ["a".repeat(1500), "a".repeat(1500)];
    mocks.fetchUsage.mockResolvedValue(usage(1_200));
    render(<Home />);
    submit();
    const msg = await screen.findByText(/翻訳を始めませんでした/);
    expect(msg.textContent).toContain("3,000文字");
    expect(msg.textContent).toContain("1,200文字");
  });

  it("残りとちょうど同じ文字数なら、警告せずに翻訳する(境界)", async () => {
    chunks = ["a".repeat(600)];
    mocks.fetchUsage.mockResolvedValue(usage(600));
    render(<Home />);
    submit();
    expect(await screen.findByText("Extracted Sentences (1)")).toBeTruthy();
    expect(callsTo("/api/process", "translate")).toHaveLength(1);
  });

  it("短いチャンクは最低課金(500文字)で数える。実際の文字数だけで見ると足りるように見えても警告する", async () => {
    chunks = ["Short one.", "Short two.", "Short three."]; // 実際は30文字ほどだが、課金は 500×3 = 1,500
    mocks.fetchUsage.mockResolvedValue(usage(1_000));
    render(<Home />);
    submit();
    const msg = await screen.findByText(/翻訳を始めませんでした/);
    expect(msg.textContent).toContain("1,500文字");
    expect(callsTo("/api/process", "translate")).toHaveLength(0);
  });

  it("最低課金で数えても残りに収まるなら、翻訳する(境界)", async () => {
    chunks = ["Short one.", "Short two."];
    mocks.fetchUsage.mockResolvedValue(usage(1_000));
    render(<Home />);
    submit();
    expect(await screen.findByText("Extracted Sentences (2)")).toBeTruthy();
  });

  it("残りを取得できなければ、事前チェックは省いて翻訳する(最終判定はサーバーが行う)", async () => {
    mocks.fetchUsage.mockResolvedValue(null);
    render(<Home />);
    submit();
    expect(await screen.findByText("Extracted Sentences (3)")).toBeTruthy();
    expect(callsTo("/api/process", "translate")).toHaveLength(3);
  });
});

describe("ホーム画面: 正常に完了したとき", () => {
  it("ログイン済み: 全チャンクを翻訳し、履歴に1回だけ保存する", async () => {
    mocks.session.data = { user: { id: "u1" } };
    render(<Home />);
    submit();

    expect(await screen.findByText("履歴に保存しました")).toBeTruthy();
    expect(screen.getByText("Extracted Sentences (3)")).toBeTruthy();
    expect(callsTo("/api/process", "translate")).toHaveLength(3);

    const saves = callsTo("/api/documents");
    expect(saves).toHaveLength(1);
    expect(saves[0].body).toMatchObject({
      title: TEXT.slice(0, 40),
      sourceType: "paste",
      rawText: TEXT,
      sentences: [
        { position: 0, original: "Sentence 1.", translation: "文1。" },
        { position: 1, original: "Sentence 2.", translation: "文2。" },
        { position: 2, original: "Sentence 3.", translation: "文3。" },
      ],
    });
  });

  it("未ログイン: 翻訳するが、保存はしない。ログインを案内する", async () => {
    render(<Home />);
    submit();
    expect(await screen.findByText("ログインすると処理結果が履歴として保存されます")).toBeTruthy();
    expect(callsTo("/api/documents")).toHaveLength(0);
  });

  it("完了したら、残りの表示を更新する", async () => {
    render(<Home />);
    submit();
    await screen.findByText("Extracted Sentences (3)");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("保存に失敗しても、翻訳結果はそのまま表示する", async () => {
    mocks.session.data = { user: { id: "u1" } };
    documentsHandler = () => json({ error: "x" }, 500);
    render(<Home />);
    submit();
    expect(await screen.findByText(/履歴への保存に失敗しました/)).toBeTruthy();
    expect(screen.getByText("Extracted Sentences (3)")).toBeTruthy();
  });
});

describe("ホーム画面: 途中で上限(429)に達したとき", () => {
  it("ログイン済み: 残りのチャンクを叩かず、翻訳できた分は表示し、履歴には保存しない", async () => {
    mocks.session.data = { user: { id: "u1" } };
    translateHandler = (n) => (n === 1 ? translated(1) : limitReached()); // 3チャンク中、2つ目で429

    render(<Home />);
    submit();

    const banner = await screen.findByText(/途中で翻訳を中断しました/);
    expect(banner.textContent).toContain("9:00(JST)"); // サーバーの案内をそのまま表示
    expect(banner.textContent).toContain("履歴には保存されません");

    // 3つ目を叩いていない(429のあと続けていない)
    expect(callsTo("/api/process", "translate")).toHaveLength(2);
    // 一部しか翻訳されていない結果を「完了」として保存していない
    expect(callsTo("/api/documents")).toHaveLength(0);
    expect(screen.queryByText("履歴に保存しました")).toBeNull();
    // 翻訳できた1件は表示されている
    expect(screen.getByText("Extracted Sentences (1)")).toBeTruthy();
    // 残りの表示を最新にする
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("DBが混み合っていて429(busy)のときも、同じように中断し、履歴には保存しない", async () => {
    mocks.session.data = { user: { id: "u1" } };
    translateHandler = (n) =>
      n === 1
        ? translated(1)
        : json({ error: "現在、アクセスが集中しています。少し時間をおいて、もう一度お試しください。", reason: "busy" }, 429);

    render(<Home />);
    submit();

    const banner = await screen.findByText(/途中で翻訳を中断しました/);
    expect(banner.textContent).toContain("アクセスが集中しています");
    expect(banner.textContent).toContain("履歴には保存されません");
    expect(callsTo("/api/process", "translate")).toHaveLength(2); // 続けて叩かない
    expect(callsTo("/api/documents")).toHaveLength(0);
  });

  it("最初のチャンクで429: 結果は空で、サーバーの案内だけを出す(「ここまでの結果」とは言わない)", async () => {
    translateHandler = () => limitReached();
    render(<Home />);
    submit();

    const banner = await screen.findByText(/本日の利用上限に達しました/);
    expect(banner.textContent).not.toContain("ここまでの結果");
    expect(callsTo("/api/process", "translate")).toHaveLength(1);
    expect(screen.queryByText(/Extracted Sentences/)).toBeNull();
    expect(callsTo("/api/documents")).toHaveLength(0);
  });

  it("429の応答が壊れていても(JSONでなくても)、既定の案内を出して中断する", async () => {
    translateHandler = () => new Response("not json", { status: 429 });
    render(<Home />);
    submit();
    expect(await screen.findByText(/利用上限に達しました/)).toBeTruthy();
    expect(callsTo("/api/process", "translate")).toHaveLength(1);
  });
});

describe("ホーム画面: 429以外のチャンクの失敗(一部が抜けた結果を「完了」として保存しない)", () => {
  it("失敗したチャンクだけ飛ばして続けるが、結果は表示するだけで、履歴には保存しない", async () => {
    mocks.session.data = { user: { id: "u1" } };
    translateHandler = (n) => (n === 2 ? json({ error: "x" }, 500) : translated(n));

    render(<Home />);
    submit();

    expect(await screen.findByText(/1個のチャンクを翻訳できませんでした/)).toBeTruthy();
    expect(callsTo("/api/process", "translate")).toHaveLength(3); // 止まらない
    expect(screen.getByText("Extracted Sentences (2)")).toBeTruthy(); // 翻訳できた分は見える
    expect(callsTo("/api/documents")).toHaveLength(0); // 抜けのある結果は保存しない
    expect(screen.queryByText("履歴に保存しました")).toBeNull();
  });

  it("連続して3回失敗したら中断する(DB障害などで、全チャンクを叩き続けない)", async () => {
    chunks = ["One.", "Two.", "Three.", "Four.", "Five."];
    translateHandler = () => json({ error: "x" }, 500);

    render(<Home />);
    submit();

    expect(await screen.findByText(/翻訳できませんでした/)).toBeTruthy();
    expect(callsTo("/api/process", "translate")).toHaveLength(3);
    expect(callsTo("/api/documents")).toHaveLength(0);
  });

  it("成功をはさむと、連続の数え直し(失敗→成功→失敗→失敗 は中断しない)", async () => {
    chunks = ["One.", "Two.", "Three.", "Four.", "Five."];
    translateHandler = (n) => (n === 2 || n === 4 || n === 5 ? json({ error: "x" }, 500) : translated(n));

    render(<Home />);
    submit();

    expect(await screen.findByText(/3個のチャンクを翻訳できませんでした/)).toBeTruthy();
    expect(callsTo("/api/process", "translate")).toHaveLength(5);
  });
});
