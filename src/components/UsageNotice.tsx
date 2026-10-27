"use client";

import { useUsage } from "./UsageProvider";
import { formatDateTimeJST } from "@/lib/format";

// 「今日あと何文字まで翻訳できるか」を表示する。取得できていないときは何も出さない。
export default function UsageNotice() {
  const { usage } = useUsage();
  if (!usage) return null;

  const { remaining, limit, minCharge, constrainedBy, resetAt } = usage.translate;
  const exhausted = remaining === 0;
  const notes: string[] = [];
  if (constrainedBy === "pool") {
    notes.push(
      exhausted
        ? "全体の利用上限に達しています"
        : "全体の利用上限が近いため、残りが少なくなっています"
    );
  }
  if (!usage.loggedIn) notes.push("ログインすると、より多く使えます");

  return (
    <div
      className={`rounded-lg border px-4 py-2 text-center text-sm ${
        exhausted
          ? "border-amber-300 bg-amber-50 text-amber-800"
          : "border-gray-200 bg-gray-50 text-gray-600"
      }`}
    >
      <p>
        本日の翻訳の残り:{" "}
        <strong>{remaining.toLocaleString("ja-JP")}</strong> / {limit.toLocaleString("ja-JP")} 文字
      </p>
      <p className="mt-0.5 text-xs">
        リセット: {formatDateTimeJST(resetAt)}
        {notes.length > 0 && ` ・ ${notes.join(" ・ ")}`}
      </p>
      <p className="mt-0.5 text-xs">
        短いテキストも、1回の翻訳につき最低 {minCharge.toLocaleString("ja-JP")} 文字分として数えます
      </p>
    </div>
  );
}
