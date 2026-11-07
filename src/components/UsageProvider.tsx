"use client";
// 今日の残りや機能の利用可否を、アプリ全体で1回だけ取得して共有するProvider。
// 制限の判定自体はサーバー側が行い、ここは表示用の値を持つだけ。

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/lib/auth-client";
import type { UsageInfo } from "@/types";

interface UsageContextValue {
  usage: UsageInfo | null;
  refresh: () => Promise<UsageInfo | null>;
}

const UsageContext = createContext<UsageContextValue>({
  usage: null,
  refresh: async () => null,
});

// 引数: なし / 返り値: 利用状況(取得失敗ならnull)のPromise
export async function fetchUsage(): Promise<UsageInfo | null> {
  try {
    const res = await fetch("/api/usage", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as UsageInfo;
  } catch {
    return null;
  }
}

// 引数: props(children: 配下の要素) / 返り値: 利用状況を共有するContext ProviderのJSX
export function UsageProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id ?? null;
  const [usage, setUsage] = useState<UsageInfo | null>(null);

  useEffect(() => {
    if (isPending) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ログイン状態の変化時、再取得まで古い値を見せないための意図したリセット
    setUsage(null);
    void fetchUsage().then((next) => {
      if (!cancelled) setUsage(next);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, isPending]);

  // 引数: なし / 返り値: 最新の利用状況(取得失敗ならnull)のPromise
  const refresh = useCallback(async () => {
    const next = await fetchUsage();
    if (next) setUsage(next);
    return next;
  }, []);

  return <UsageContext.Provider value={{ usage, refresh }}>{children}</UsageContext.Provider>;
}

// 引数: なし / 返り値: 共有されている利用状況と再取得関数
export function useUsage(): UsageContextValue {
  return useContext(UsageContext);
}
