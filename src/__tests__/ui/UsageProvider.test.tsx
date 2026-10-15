// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { UsageInfo } from "@/types";

const mocks = vi.hoisted(() => ({
  session: { data: null as null | { user: { id: string } }, isPending: false },
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => mocks.session }));

import { UsageProvider, fetchUsage, useUsage } from "@/components/UsageProvider";

const info = (remaining: number, loggedIn = false): UsageInfo => ({
  loggedIn,
  capabilities: { tts: false },
  translate: { remaining, limit: 12_000, constrainedBy: "personal", resetAt: "2026-10-16T00:00:00.000Z" },
});
const ok = (body: unknown) => ({ ok: true, json: async () => body });

const fetchMock = vi.fn();
const wrapper = ({ children }: { children: ReactNode }) => <UsageProvider>{children}</UsageProvider>;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  mocks.session = { data: null, isPending: false };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("fetchUsage", () => {
  it("キャッシュせずに /api/usage を取得する", async () => {
    fetchMock.mockResolvedValue(ok(info(100)));
    expect(await fetchUsage()).toEqual(info(100));
    expect(fetchMock).toHaveBeenCalledWith("/api/usage", { cache: "no-store" });
  });

  it("失敗(非200・通信エラー)は null を返し、例外を投げない(翻訳自体は止めない)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    expect(await fetchUsage()).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await fetchUsage()).toBeNull();
  });
});

describe("UsageProvider", () => {
  it("セッションの確認中は取得しない", () => {
    mocks.session = { data: null, isPending: true };
    const { result } = renderHook(() => useUsage(), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.usage).toBeNull();
  });

  it("セッションが確定したら1回だけ取得して、共有する", async () => {
    fetchMock.mockResolvedValue(ok(info(8_000)));
    const { result } = renderHook(() => useUsage(), { wrapper });
    await waitFor(() => expect(result.current.usage).toEqual(info(8_000)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ログイン・ログアウトで、いったん空にして取り直す(古い値を見せない)", async () => {
    fetchMock.mockResolvedValueOnce(ok(info(12_000, false)));
    const { result, rerender } = renderHook(() => useUsage(), { wrapper });
    await waitFor(() => expect(result.current.usage?.loggedIn).toBe(false));

    // 2回目の取得は、完了を待たせて、途中の状態を確認する
    let finish!: (v: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    mocks.session = { data: { user: { id: "u1" } }, isPending: false };
    rerender();

    await waitFor(() => expect(result.current.usage).toBeNull()); // 古い値は消えている
    await act(async () => finish(ok(info(30_000, true))));
    await waitFor(() => expect(result.current.usage?.loggedIn).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refresh() は取り直して、新しい値を返し、共有している値も更新する", async () => {
    fetchMock.mockResolvedValueOnce(ok(info(8_000)));
    const { result } = renderHook(() => useUsage(), { wrapper });
    await waitFor(() => expect(result.current.usage?.translate.remaining).toBe(8_000));

    fetchMock.mockResolvedValueOnce(ok(info(7_000)));
    let returned: UsageInfo | null = null;
    await act(async () => {
      returned = await result.current.refresh();
    });
    expect(returned).toEqual(info(7_000));
    expect(result.current.usage?.translate.remaining).toBe(7_000);
  });

  it("取得に失敗しても、例外にならず、値は null のまま", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useUsage(), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.usage).toBeNull();
  });

  it("Provider の外では、空の値を返す(画面が壊れない)", () => {
    const { result } = renderHook(() => useUsage());
    expect(result.current.usage).toBeNull();
  });
});
