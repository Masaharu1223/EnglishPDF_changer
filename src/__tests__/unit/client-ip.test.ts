import { describe, expect, it } from "vitest";
import { getClientIp, normalizeIp } from "@/lib/client-ip";

describe("normalizeIp", () => {
  it("IPv4 はそのまま返す(前後の空白は除く)", () => {
    expect(normalizeIp("203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIp("  203.0.113.9  ")).toBe("203.0.113.9");
  });

  it("IPv4-mapped IPv6 は IPv4 として扱う", () => {
    expect(normalizeIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("IPv6 は /64(前半4グループ)にまとめる", () => {
    expect(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:0db8:0001:0002::/64");
  });

  it("同じ /64 の別アドレスは、同じ主体として扱う(IPごとの上限を回避させない)", () => {
    expect(normalizeIp("2001:db8:1:2:1111:2222:3333:4444")).toBe(
      normalizeIp("2001:db8:1:2:ffff:eeee:dddd:cccc")
    );
  });

  it("別の /64 は、別の主体として扱う", () => {
    expect(normalizeIp("2001:db8:1:2::1")).not.toBe(normalizeIp("2001:db8:1:3::1"));
  });

  it("'::' の省略表記を正しく展開する", () => {
    expect(normalizeIp("2001:db8::1")).toBe("2001:0db8:0000:0000::/64");
    expect(normalizeIp("2001:db8:0:0:1::1")).toBe("2001:0db8:0000:0000::/64");
    expect(normalizeIp("::1")).toBe("0000:0000:0000:0000::/64");
    expect(normalizeIp("::")).toBe("0000:0000:0000:0000::/64");
  });

  it("16進数の大文字は小文字にそろえる", () => {
    expect(normalizeIp("2001:DB8::1")).toBe(normalizeIp("2001:db8::1"));
  });

  it("末尾が IPv4 表記の IPv6 も展開できる", () => {
    expect(normalizeIp("64:ff9b::1.2.3.4")).toBe("0064:ff9b:0000:0000::/64");
  });

  it("ゾーンID(%eth0)は無視する", () => {
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80:0000:0000:0000::/64");
  });

  it("判別できない値は 'unknown' にまとめる", () => {
    expect(normalizeIp("")).toBe("unknown");
    expect(normalizeIp("garbage")).toBe("unknown");
    expect(normalizeIp("999.1.1.1")).toBe("unknown");
    expect(normalizeIp("1.2.3")).toBe("unknown");
  });
});

describe("getClientIp", () => {
  it("ヘッダーがなければ 'unknown'", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
  });

  it("x-forwarded-for が複数あれば、先頭(元のクライアント)を使う", () => {
    const h = new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1, 10.0.0.2" });
    expect(getClientIp(h)).toBe("198.51.100.7");
  });

  it("x-vercel-forwarded-for を最優先する(手前のプロキシに上書きされないため)", () => {
    const h = new Headers({
      "x-vercel-forwarded-for": "198.51.100.1",
      "x-forwarded-for": "9.9.9.9",
      "x-real-ip": "8.8.8.8",
    });
    expect(getClientIp(h)).toBe("198.51.100.1");
  });

  it("x-forwarded-for がなければ x-real-ip を使う", () => {
    expect(getClientIp(new Headers({ "x-real-ip": "198.51.100.5" }))).toBe("198.51.100.5");
  });

  it("不正な値は 'unknown'(共有の枠)になる", () => {
    expect(getClientIp(new Headers({ "x-forwarded-for": "not-an-ip" }))).toBe("unknown");
  });
});
