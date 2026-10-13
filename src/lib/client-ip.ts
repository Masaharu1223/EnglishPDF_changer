import { isIP } from "node:net";

// IPv6 は端末ごとにアドレスが変わる(プライバシー拡張)ため、1つの回線がほぼ
// 無限にアドレスを持てる。通常、1つの回線には /64 が割り当てられるので、前半4グループを
// 1つの主体としてまとめる。まとめないと、IPごとの上限を簡単に回避できてしまう。
function expandIpv6(ip: string): string[] {
  let addr = ip.split("%")[0]; // ゾーンID(fe80::1%eth0 の %eth0)は除く

  // 末尾が IPv4 表記(::ffff:1.2.3.4 以外の 64:ff9b::1.2.3.4 など)なら16進2グループに直す
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

// 判別できないものは "unknown" にまとめる。unknown は1つの共有の枠になる(安全側)。
export function normalizeIp(raw: string): string {
  let ip = raw.trim();

  // IPv4-mapped IPv6(::ffff:1.2.3.4)は IPv4 として扱う
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) ip = mapped[1];

  const version = isIP(ip);
  if (version === 4) return ip;
  if (version === 6) return `${expandIpv6(ip).slice(0, 4).join(":")}::/64`;
  return "unknown";
}

// Vercel では x-forwarded-for がクライアントの公開IPで、外部から付けられた値は
// 上書きされる(偽装の防止)。x-vercel-forwarded-for は同じ値で、手前にプロキシを
// 置いても上書きされないため、先に見る。
export function getClientIp(headers: Headers): string {
  const raw =
    headers.get("x-vercel-forwarded-for") ??
    headers.get("x-forwarded-for") ??
    headers.get("x-real-ip");
  if (!raw) return "unknown";
  return normalizeIp(raw.split(",")[0]);
}
