import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { resolveTestDb } from "./db-env";
import type { Reservation, UsageSubject } from "@/lib/usage";

// 本物のPostgres(Neonのテスト用ブランチ)で、使用量の予約・返却・残量を確かめる。
// 同時に大量のリクエストが来ても上限を超えないこと、半端な状態が残らないことが主眼。
// DATABASE_URL_TEST_OWNER が未設定なら、このファイルのテストは飛ばされる。
const db = resolveTestDb();

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

describe.skipIf(!db)("usage テーブルの予約・返却(本物のPostgres)", () => {
  let owner: Pool;
  let usage: typeof import("@/lib/usage");
  let dbModule: typeof import("@/lib/db");
  const originalAppUrl = process.env.DATABASE_URL_APP;

  const user = (id = randomUUID()): UsageSubject => ({ type: "user", userId: id });
  const anon = (ip: string): UsageSubject => ({ type: "anon", ip });
  const sub = (s: UsageSubject) => (s as { userId: string }).userId;

  // 所有者ロールで、テーブルの中身を直接読む(アプリの経路を通さずに確かめるため)
  const amount = async (key: string): Promise<number | null> => {
    const r = await owner.query("select amount from usage where subject_key = $1", [key]);
    return r.rows[0]?.amount ?? null;
  };
  const allRows = async () =>
    (await owner.query("select subject_key, amount from usage order by subject_key")).rows;

  beforeAll(async () => {
    // アプリの接続先を、テスト用ブランチ(app_user)に差し替えてから、モジュールを読み込む
    process.env.DATABASE_URL_APP = db!.appUrl;
    owner = new Pool({ connectionString: db!.ownerUrl });
    usage = await import("@/lib/usage");
    dbModule = await import("@/lib/db");
  });

  afterAll(async () => {
    await owner.query("truncate usage");
    await owner.end();
    await dbModule.getPool().end();
    process.env.DATABASE_URL_APP = originalAppUrl;
  });

  beforeEach(async () => {
    await owner.query("truncate usage");
    vi.stubEnv("BETTER_AUTH_SECRET", "integration-test-secret");
    vi.stubEnv("USAGE_LIMIT_USER_CHARS", "1000");
    vi.stubEnv("USAGE_LIMIT_OTHERS_TOTAL_CHARS", "140000");
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("基本の予約", () => {
    it("予約すると、個人の枠と全体の枠が、両方とも加算される。日付はUTC", async () => {
      const u = user();
      const res = await usage.reserveUsage(u, "translate_chars", 300);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(await amount(`u:${sub(u)}`)).toBe(300);
      expect(await amount("others:*")).toBe(300);
      const today = (await owner.query("select (now() at time zone 'utc')::date::text as d")).rows[0].d;
      expect(res.reservation.day).toBe(today);
    });

    it("同じ主体が続けて予約すると、累計される", async () => {
      const u = user();
      await usage.reserveUsage(u, "translate_chars", 300);
      await usage.reserveUsage(u, "translate_chars", 200);
      expect(await amount(`u:${sub(u)}`)).toBe(500);
      expect(await amount("others:*")).toBe(500);
    });

    it("前日の行は、今日の上限に数えない", async () => {
      const u = user();
      await owner.query(
        "insert into usage (subject_key, day, kind, amount) values ($1, (now() at time zone 'utc')::date - 1, 'translate_chars', 1000)",
        [`u:${sub(u)}`]
      );
      expect((await usage.getRemainingUsage(u, "translate_chars")).remaining).toBe(1000);
      expect((await usage.reserveUsage(u, "translate_chars", 1000)).ok).toBe(true);
    });
  });

  describe("上限の境界", () => {
    it("上限ちょうどは許可し、+1 は拒否する。拒否しても、どの枠も変わらない", async () => {
      const u = user();
      expect((await usage.reserveUsage(u, "translate_chars", 1000)).ok).toBe(true);

      const over = await usage.reserveUsage(u, "translate_chars", 1);
      expect(over).toEqual({ ok: false, reason: "personal" });
      expect(await amount(`u:${sub(u)}`)).toBe(1000);
      expect(await amount("others:*")).toBe(1000);
    });

    it("【回帰】新しい主体の最初の予約が上限を超えるなら、拒否する(行も作らない)", async () => {
      // ON CONFLICT ... WHERE だけの書き方では、新規行の初回が上限を素通りした
      const res = await usage.reserveUsage(user(), "translate_chars", 1001);
      expect(res).toEqual({ ok: false, reason: "personal" });
      expect(await allRows()).toEqual([]);
    });

    it("個人は空いていても、全体が満杯なら拒否する(reason は pool)。個人の枠は作らない", async () => {
      vi.stubEnv("USAGE_LIMIT_OTHERS_TOTAL_CHARS", "500");
      const a = user();
      const b = user();
      expect((await usage.reserveUsage(a, "translate_chars", 400)).ok).toBe(true);

      const res = await usage.reserveUsage(b, "translate_chars", 200);
      expect(res).toEqual({ ok: false, reason: "pool" });
      expect(await amount(`u:${sub(b)}`)).toBeNull();
      expect(await amount("others:*")).toBe(400);
    });

    it("【複数の枠】途中の枠で失敗したら、先に加算した枠も取り消される(片方だけ減らない)", async () => {
      // 未ログインの枠は、キーの順に anon:* → ip:… → others:* と処理する。
      // 最後の others:* で失敗したとき、先の2つの加算が残らないことを確かめる
      vi.stubEnv("USAGE_LIMIT_ANON_IP_CHARS", "1000");
      vi.stubEnv("USAGE_LIMIT_OTHERS_TOTAL_CHARS", "500");
      const res = await usage.reserveUsage(anon("198.51.100.7"), "translate_chars", 600);
      expect(res).toEqual({ ok: false, reason: "pool" });
      expect(await allRows()).toEqual([]);
    });

    it("個人の枠が満杯でも、全体の枠は消費されない", async () => {
      const u = user();
      vi.stubEnv("USAGE_LIMIT_USER_CHARS", "100");
      await usage.reserveUsage(u, "translate_chars", 100);
      const before = await amount("others:*");
      const res = await usage.reserveUsage(u, "translate_chars", 1);
      expect(res).toEqual({ ok: false, reason: "personal" });
      expect(await amount("others:*")).toBe(before);
    });

    it("owner は、全体の予算(others:*)には数えない", async () => {
      const o: UsageSubject = { type: "owner", userId: randomUUID() };
      expect((await usage.reserveUsage(o, "translate_chars", 5000)).ok).toBe(true);
      expect(await amount("others:*")).toBeNull();
    });
  });

  describe("返却", () => {
    it("予約を返却すると、元の量に戻る", async () => {
      const u = user();
      const res = await usage.reserveUsage(u, "translate_chars", 300);
      if (!res.ok) throw new Error("予約できるはず");
      await usage.refundUsage(res.reservation);
      expect(await amount(`u:${sub(u)}`)).toBe(0);
      expect(await amount("others:*")).toBe(0);
    });

    it("返却しすぎても、0未満にならない", async () => {
      const u = user();
      const res = await usage.reserveUsage(u, "translate_chars", 300);
      if (!res.ok) throw new Error("予約できるはず");
      await usage.refundUsage(res.reservation);
      await usage.refundUsage(res.reservation); // 二重に返却
      expect(await amount(`u:${sub(u)}`)).toBe(0);
    });

    it("予約した日の行だけを戻す(別の日の行は変えない)", async () => {
      const u = user();
      const res = await usage.reserveUsage(u, "translate_chars", 300);
      if (!res.ok) throw new Error("予約できるはず");
      const otherDay: Reservation = { ...res.reservation, day: "2000-01-01" };
      await usage.refundUsage(otherDay); // 今日の行には当たらない
      expect(await amount(`u:${sub(u)}`)).toBe(300);
    });

    it("返却したあとは、また使える(枠が空く)", async () => {
      const u = user();
      const res = await usage.reserveUsage(u, "translate_chars", 1000);
      if (!res.ok) throw new Error("予約できるはず");
      expect((await usage.reserveUsage(u, "translate_chars", 1)).ok).toBe(false);
      await usage.refundUsage(res.reservation);
      expect((await usage.reserveUsage(u, "translate_chars", 1000)).ok).toBe(true);
    });
  });

  describe("同時実行(この仕組みの肝)", () => {
    it("【50並列】上限1,000に対し100文字ずつ → 成功はちょうど10件、最終値は1,000(超えない)", async () => {
      const u = user();
      const results = await Promise.all(
        Array.from({ length: 50 }, () => usage.reserveUsage(u, "translate_chars", 100))
      );
      const ok = results.filter((r) => r.ok).length;
      expect(ok).toBe(10);
      expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "personal")).toBe(true);
      expect(await amount(`u:${sub(u)}`)).toBe(1000);
      expect(await amount("others:*")).toBe(1000);
    });

    it("【デッドロックなし・整合】未ログインとログイン済みが、同じ全体の枠を取り合う200リクエスト", async () => {
      vi.stubEnv("USAGE_LIMIT_OTHERS_TOTAL_CHARS", "5000");
      vi.stubEnv("USAGE_LIMIT_USER_CHARS", "100000");
      vi.stubEnv("USAGE_LIMIT_ANON_IP_CHARS", "100000");
      vi.stubEnv("USAGE_LIMIT_ANON_TOTAL_CHARS", "100000");

      const anonSubjects = Array.from({ length: 100 }, (_, i) => anon(`198.51.100.${i + 1}`));
      const userSubjects = Array.from({ length: 100 }, () => user());
      // 順番を混ぜて、キーの取る順番が食い違う状況を作る
      const all = anonSubjects.flatMap((a, i) => [a, userSubjects[i]]);

      const settled = await Promise.allSettled(
        all.map((s) => usage.reserveUsage(s, "translate_chars", 100))
      );

      // デッドロック(Postgres の 40P01)や、その他の例外が1件も出ない
      expect(settled.filter((s) => s.status === "rejected")).toEqual([]);

      const results = settled.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof usage.reserveUsage>>>).value);
      const okAll = results.filter((r) => r.ok).length;
      const okAnon = results.filter((r, i) => r.ok && all[i].type === "anon").length;

      // 全体の枠は、ちょうど 5,000 で止まる(200件中、成功は50件)
      expect(okAll).toBe(50);
      expect(await amount("others:*")).toBe(5000);
      // 先に加算してから取り消された分が、残っていない(未ログイン全体の合計 = 成功した未ログインの数 × 100)
      expect(await amount("anon:*")).toBe(okAnon > 0 ? okAnon * 100 : null);
      const ipSum = (await owner.query("select coalesce(sum(amount),0)::int s from usage where subject_key like 'ip:%'")).rows[0].s;
      expect(ipSum).toBe(okAnon * 100);
    });

    it("予約と返却が同時に起きても、最終値は(成功した予約 − 返却)と一致する", async () => {
      const u = user();
      vi.stubEnv("USAGE_LIMIT_USER_CHARS", "100000");
      // 先に20件を予約しておく(2,000文字)
      const first = await Promise.all(
        Array.from({ length: 20 }, () => usage.reserveUsage(u, "translate_chars", 100))
      );
      const reservations = first.map((r) => {
        if (!r.ok) throw new Error("予約できるはず");
        return r.reservation;
      });

      // その20件の返却と、新しい20件の予約を、同時に流す
      await Promise.all([
        ...reservations.map((r) => usage.refundUsage(r)),
        ...Array.from({ length: 20 }, () => usage.reserveUsage(u, "translate_chars", 100)),
      ]);

      expect(await amount(`u:${sub(u)}`)).toBe(2000); // 2000 - 2000 + 2000
      expect(await amount("others:*")).toBe(2000);
    });
  });

  describe("残量の取得(読み取りだけ)", () => {
    it("個人の枠と全体の枠のうち、小さいほうを返し、何が制約かも返す。書き込みはしない", async () => {
      vi.stubEnv("USAGE_LIMIT_OTHERS_TOTAL_CHARS", "500");
      const u = user();
      await usage.reserveUsage(u, "translate_chars", 300);
      const before = await allRows();

      const r = await usage.getRemainingUsage(u, "translate_chars");
      expect(r).toEqual({ remaining: 200, limit: 1000, constrainedBy: "pool" }); // 個人は700、全体は200

      expect(await allRows()).toEqual(before);
    });

    it("個人の枠のほうが小さいときは personal", async () => {
      const u = user();
      await usage.reserveUsage(u, "translate_chars", 300);
      expect(await usage.getRemainingUsage(u, "translate_chars")).toEqual({
        remaining: 700,
        limit: 1000,
        constrainedBy: "personal",
      });
    });

    it("何も使っていない主体は、上限いっぱいが残っている", async () => {
      expect((await usage.getRemainingUsage(user(), "translate_chars")).remaining).toBe(1000);
    });
  });

  describe("権限と失敗時の挙動", () => {
    it("アプリ用ロール(app_user)は、使用量の行を消せない・テーブルを空にできない", async () => {
      await usage.reserveUsage(user(), "translate_chars", 100);
      const pool = dbModule.getPool();
      await expect(pool.query("delete from usage")).rejects.toThrow(/permission denied/);
      await expect(pool.query("truncate usage")).rejects.toThrow(/permission denied/);
    });

    it("DBに接続できないときは、予約が例外になる(使い放題にならない)。返却は例外にしない", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const saved = process.env.DATABASE_URL_APP;
      try {
        vi.resetModules();
        process.env.DATABASE_URL_APP = "postgresql://nobody:nopass@127.0.0.1:1/nodb";
        const broken = await import("@/lib/usage");

        await expect(broken.reserveUsage(user(), "translate_chars", 100)).rejects.toThrow();
        // 返却の失敗は、元の処理を邪魔しないようにログだけ残す
        await expect(
          broken.refundUsage({ keys: ["u:x"], day: "2026-01-01", kind: "translate_chars", amount: 1 })
        ).resolves.toBeUndefined();
      } finally {
        process.env.DATABASE_URL_APP = saved;
        vi.restoreAllMocks();
      }
    });

    it("amount が正の整数でなければ、DBに触れず例外にする", async () => {
      await expect(usage.reserveUsage(user(), "translate_chars", 0)).rejects.toThrow("positive integer");
      await expect(usage.reserveUsage(user(), "translate_chars", -5)).rejects.toThrow("positive integer");
      await expect(usage.reserveUsage(user(), "translate_chars", 1.5)).rejects.toThrow("positive integer");
      expect(await allRows()).toEqual([]);
    });
  });
});
