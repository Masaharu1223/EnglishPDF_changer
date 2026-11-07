// リクエストヘッダーからクライアントのIPアドレスを取り出し、利用制限の単位として使える形に正規化する。
// IPv6 は /64 単位にまとめ、判別できないものは "unknown" にする。

import { isIP } from "node:net";

// 引数: IPv6アドレスの文字列 / 返り値: 省略を展開した、4桁16進数8グループの配列
function expandIpv6(ip: string): string[] {
  let addr = ip.split("%")[0];

  if (addr.includes(".")) {
    const idx = addr.lastIndexOf(":");
    const [a, b, c, d] = addr.slice(idx + 1).split(".").map(Number);
    addr = `${addr.slice(0, idx + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [head, tail] = addr.split("::");
  const headGroups = head ? head.split(":") : [];
  if (tail === undefined) {
    return headGroups.map((g) => g.toLowerCase().padStart(4, "0"));
  }
  const tailGroups = tail ? tail.split(":") : [];
  const fill = new Array<string>(8 - headGroups.length - tailGroups.length).fill("0");
  return [...headGroups, ...fill, ...tailGroups].map((g) => g.toLowerCase().padStart(4, "0"));
}

// 引数: IPアドレスの文字列 / 返り値: IPv4はそのまま、IPv6は /64 表記、判別不能なら "unknown"
export function normalizeIp(raw: string): string {
  let ip = raw.trim();

  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) ip = mapped[1];

  const version = isIP(ip);
  if (version === 4) return ip;
  if (version === 6) return `${expandIpv6(ip).slice(0, 4).join(":")}::/64`;
  return "unknown";
}

// 引数: リクエストヘッダー / 返り値: 正規化したクライアントIP(取れなければ "unknown")
export function getClientIp(headers: Headers): string {
  const raw =
    headers.get("x-vercel-forwarded-for") ??
    headers.get("x-forwarded-for") ??
    headers.get("x-real-ip");
  if (!raw) return "unknown";
  return normalizeIp(raw.split(",")[0]);
}
