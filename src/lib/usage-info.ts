// 画面に返す利用状況(今日の残り翻訳文字数と、使える機能)を組み立てる。
// /api/usage と、翻訳チケットの発行のレスポンスで共用する。

import { isFeatureAllowed } from "@/lib/access";
import { getUsageLimits } from "@/lib/usage-limits";
import { getRemainingUsage, nextResetAtIso, type UsageSubject } from "@/lib/usage";
import type { UsageInfo } from "@/types";

type UsageUser = Parameters<typeof isFeatureAllowed>[0];

// 引数: ログイン中のユーザー(未ログインなら null)、使用量の対象 / 返り値: 画面に返す利用状況
export async function buildUsageInfo(user: UsageUser, subject: UsageSubject): Promise<UsageInfo> {
  const translate = await getRemainingUsage(subject, "translate_chars");
  return {
    loggedIn: !!user,
    capabilities: { tts: isFeatureAllowed(user) },
    translate: {
      ...translate,
      minCharge: getUsageLimits().minChargeChars,
      resetAt: nextResetAtIso(),
    },
  };
}
