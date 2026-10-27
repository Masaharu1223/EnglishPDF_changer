"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/lib/auth-client";
import type { UsageInfo } from "@/types";

// 画面に出す「今日の残り」と、音声などの機能を使えるかを、アプリ全体で1回だけ取得して共有する。
// (文ごとのカードが何百枚もあるので、カードごとにAPIを呼ばないようにする)
// ここで取るのは表示のための値で、制限の判定はサーバー側(各APIルート)が別に行う。

interface UsageContextValue {
  usage: UsageInfo | null;
  refresh: () => Promise<UsageInfo | null>;
}

const UsageContext = createContext<UsageContextValue>({
  usage: null,
  refresh: async () => null,
});

export async function fetchUsage(): Promise<UsageInfo | null> {
  try {
    const res = await fetch("/api/usage", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as UsageInfo;
  } catch {
    return null; // 取得できなくても、表示を出さないだけ。翻訳自体は止めない
  }
}

export function UsageProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id ?? null;
  const [usage, setUsage] = useState<UsageInfo | null>(null);

  // ログイン・ログアウトで、使える機能や上限が変わるので取り直す。
  // 古い値を見せないよう、いったん空にする。セッションの確認中は取得しない。
  useEffect(() => {
    if (isPending) return;
    let cancelled = false;
    setUsage(null);
    void fetchUsage().then((next) => {
      if (!cancelled) setUsage(next);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, isPending]);

  const refresh = useCallback(async () => {
    const next = await fetchUsage();
    // 一時的な取得失敗で、表示を消したり、音声ボタンを無効にしたりしない。前回の値を残す
    if (next) setUsage(next);
    return next;
  }, []);

  return <UsageContext.Provider value={{ usage, refresh }}>{children}</UsageContext.Provider>;
}

export function useUsage(): UsageContextValue {
  return useContext(UsageContext);
}
