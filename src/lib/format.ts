// 画面に出す日時と、翻訳の残量不足の警告文を整形する。
// 日時は DB の UTC のまま受け取り、表示のときだけ JST にする。

import type { UsageInfo } from "@/types";

const jstFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// 引数: ISO 8601 形式の日時文字列 / 返り値: 「(JST)」付きの日本時間の表示文字列
export function formatDateTimeJST(iso: string): string {
  return `${jstFormatter.format(new Date(iso))} (JST)`;
}

// 引数: 文書の合計文字数、利用状況 / 返り値: 本日の残りを超えるときに出す警告文
export function overLimitMessage(totalChars: number, usage: UsageInfo): string {
  const { remaining, constrainedBy, resetAt } = usage.translate;
  // 引数: 数値 / 返り値: 日本語の桁区切りにした文字列
  const formatCount = (value: number) => value.toLocaleString("ja-JP");
  const parts = [
    `このテキストは約${formatCount(totalChars)}文字で、本日の残り(${formatCount(remaining)}文字)を超えているため、翻訳を始めませんでした。`,
  ];
  if (constrainedBy === "pool") parts.push("現在、全体の利用上限が近づいています。");
  parts.push(
    usage.loggedIn
      ? "テキストを短くするか、リセット後にお試しください。"
      : "テキストを短くするか、ログインするとより多く使えます。"
  );
  parts.push(`上限は${formatDateTimeJST(resetAt)}にリセットされます。`);
  return parts.join(" ");
}
