// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UsageInfo } from "@/types";

const mocks = vi.hoisted(() => ({ usage: null as UsageInfo | null }));
vi.mock("@/components/UsageProvider", () => ({
  useUsage: () => ({ usage: mocks.usage, refresh: vi.fn() }),
}));

import SentenceCard from "@/components/SentenceCard";

const usage = (loggedIn: boolean, tts: boolean): UsageInfo => ({
  loggedIn,
  capabilities: { tts },
  translate: { remaining: 100, limit: 100, constrainedBy: "personal", resetAt: "2026-10-16T00:00:00.000Z" },
});

const sentence = { id: "s0", original: "Hello world.", translation: "こんにちは世界。" };
const button = () => screen.getByRole("button") as HTMLButtonElement;

const fetchMock = vi.fn();
let playSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  // jsdom には音声の再生機能がない
  playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  mocks.usage = null;
});

describe("SentenceCard の再生ボタン(音声は試験導入で、許可されたアカウントだけ)", () => {
  it("使用状況を取得中は、無効で「確認中...」", () => {
    mocks.usage = null;
    render(<SentenceCard sentence={sentence} index={0} />);
    expect(button().disabled).toBe(true);
    expect(button().title).toBe("確認中...");
  });

  it("未ログイン: 無効で、ログインが必要な旨を案内する", () => {
    mocks.usage = usage(false, false);
    render(<SentenceCard sentence={sentence} index={0} />);
    expect(button().disabled).toBe(true);
    expect(button().title).toContain("限定公開");
    expect(button().title).toContain("ログインが必要");
  });

  it("ログイン済みで許可リスト外: 無効で、限定公開中と案内する(ログインを促さない)", () => {
    mocks.usage = usage(true, false);
    render(<SentenceCard sentence={sentence} index={0} />);
    expect(button().disabled).toBe(true);
    expect(button().title).toContain("限定公開");
    expect(button().title).not.toContain("ログインが必要");
  });

  it("許可されたアカウント: 有効", () => {
    mocks.usage = usage(true, true);
    render(<SentenceCard sentence={sentence} index={0} />);
    expect(button().disabled).toBe(false);
    expect(button().title).toBe("Play");
  });

  it("許可されていなくても、取得済みの音声(audioUrl)があれば再生できる(APIを呼ばないため)", () => {
    mocks.usage = usage(true, false);
    render(<SentenceCard sentence={{ ...sentence, audioUrl: "data:audio/mpeg;base64,AAAA" }} index={0} />);
    expect(button().disabled).toBe(false);
  });

  it("無効のボタンを押しても、APIを呼ばない", () => {
    mocks.usage = usage(false, false);
    render(<SentenceCard sentence={sentence} index={0} />);
    fireEvent.click(button());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("許可されたアカウントが押すと、原文を /api/tts に送って再生する", async () => {
    mocks.usage = usage(true, true);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ audioUrl: "data:audio/mpeg;base64,AAAA" }) });
    render(<SentenceCard sentence={sentence} index={0} />);
    fireEvent.click(button());

    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tts");
    expect(JSON.parse(init.body)).toEqual({ text: "Hello world." });
  });

  it("サーバーが403を返しても(表示と実際の権限がずれても)、壊れず、再生しない", async () => {
    mocks.usage = usage(true, true);
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    render(<SentenceCard sentence={sentence} index={0} />);
    fireEvent.click(button());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button().disabled).toBe(false)); // 読み込み中の表示が戻る
    expect(playSpy).not.toHaveBeenCalled();
  });
});
