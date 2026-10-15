// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { UsageInfo } from "@/types";

const mocks = vi.hoisted(() => ({ usage: null as UsageInfo | null }));
vi.mock("@/components/UsageProvider", () => ({
  useUsage: () => ({ usage: mocks.usage, refresh: vi.fn() }),
}));

import UsageNotice from "@/components/UsageNotice";

const usage = (
  translate: Partial<UsageInfo["translate"]> = {},
  loggedIn = false
): UsageInfo => ({
  loggedIn,
  capabilities: { tts: false },
  translate: {
    remaining: 8_000,
    limit: 12_000,
    constrainedBy: "personal",
    resetAt: "2026-10-16T00:00:00.000Z",
    ...translate,
  },
});

afterEach(() => {
  cleanup();
  mocks.usage = null;
});

describe("UsageNotice(今日の残りの表示)", () => {
  it("取得できていないときは、何も表示しない", () => {
    mocks.usage = null;
    const { container } = render(<UsageNotice />);
    expect(container.firstChild).toBeNull();
  });

  it("残り・上限を桁区切りで、リセット時刻をタイムゾーンつきで表示する", () => {
    mocks.usage = usage();
    const { container } = render(<UsageNotice />);
    expect(container.textContent).toContain("本日の翻訳の残り");
    expect(container.textContent).toContain("8,000");
    expect(container.textContent).toContain("12,000");
    expect(container.textContent).toContain("リセット: 2026/10/16 09:00 (JST)");
  });

  it("未ログインには、ログインの案内を出す", () => {
    mocks.usage = usage({}, false);
    const { container } = render(<UsageNotice />);
    expect(container.textContent).toContain("ログインすると、より多く使えます");
  });

  it("ログイン済みには、ログインの案内を出さない", () => {
    mocks.usage = usage({}, true);
    const { container } = render(<UsageNotice />);
    expect(container.textContent).not.toContain("ログインすると");
  });

  it("残りがあるうちは、通常の色(警告色にしない)", () => {
    mocks.usage = usage();
    const { container } = render(<UsageNotice />);
    expect((container.firstChild as HTMLElement).className).not.toContain("amber");
  });

  it("全体の上限が制約で、残りがあるとき: 残りが少なくなっている旨を出す", () => {
    mocks.usage = usage({ constrainedBy: "pool", remaining: 500 });
    const { container } = render(<UsageNotice />);
    expect(container.textContent).toContain("全体の利用上限が近いため");
  });

  it("全体の上限に達したとき: 警告色にして、その旨を出す", () => {
    mocks.usage = usage({ constrainedBy: "pool", remaining: 0 });
    const { container } = render(<UsageNotice />);
    expect(container.textContent).toContain("全体の利用上限に達しています");
    expect((container.firstChild as HTMLElement).className).toContain("amber");
  });

  it("個人の上限に達したとき: 警告色にして、残り0を表示する(全体の上限の文言は出さない)", () => {
    mocks.usage = usage({ constrainedBy: "personal", remaining: 0 });
    const { container } = render(<UsageNotice />);
    expect((container.firstChild as HTMLElement).className).toContain("amber");
    expect(container.textContent).toContain("0");
    expect(container.textContent).not.toContain("全体の利用上限");
  });
});
