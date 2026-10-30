import type { UsageInfo } from "@/types";

// DBにはUTC(timestamptz)のまま保存し、表示時にのみローカルタイムゾーンへ変換する。
// 独自のオフセット計算はせず、ネイティブのIntl.DateTimeFormatを使う。
const jstFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTimeJST(iso: string): string {
  return `${jstFormatter.format(new Date(iso))} (JST)`;
}

// 翻訳を始める前に、文書が今日の残りを超えるときの警告文。
// 表示のための事前チェックで、実際の判定は翻訳APIがサーバー側で行う。
export function overLimitMessage(totalChars: number, usage: UsageInfo): string {
  const { remaining, constrainedBy, resetAt } = usage.translate;
  const n = (v: number) => v.toLocaleString("ja-JP");
  const parts = [
    `このテキストは約${n(totalChars)}文字で、本日の残り(${n(remaining)}文字)を超えているため、翻訳を始めませんでした。`,
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

