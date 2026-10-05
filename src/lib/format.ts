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
