// 本物のPostgres(Neonのテスト用ブランチ)で、使用量の予約・返却・残量を確かめる統合テスト。
// DATABASE_URL_TEST_OWNER が未設定なら、このファイルのテストは飛ばされる。

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { resolveTestDb } from "./db-env";
import type { Reservation, UsageSubject } from "@/lib/usage";

const db = resolveTestDb();

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

describe.skipIf(!db)("usage テーブルの予約・返却(本物のPostgres)", () => {
  let owner: Pool;
  let usage: typeof import("@/lib/usage");
  let dbModule: typeof import("@/lib/db");
  const originalAppUrl = process.env.DATABASE_URL_APP;

  // 引数: ユーザーID(省略時は乱数) / 返り値: ログイン済みユーザーの主体
  const user = (id = randomUUID()): UsageSubject => ({ type: "user", userId: id });
  // 引数: IPアドレス / 返り値: 未ログインの主体
  const anon = (ip: string): UsageSubject => ({ type: "anon", ip });
  // 引数: 主体 / 返り値: その主体のユーザーID
  const sub = (s: UsageSubject) => (s as { userId: string }).userId;

  // 引数: 主体キー / 返り値: 所有者ロールで直接読んだ量(行がなければ null)
  const amount = async (key: string): Promise<number | null> => {
    const r = await owner.query("select amount from usage where subject_key = $1", [key]);
    return r.rows[0]?.amount ?? null;
  };
  // 引数: なし / 返り値: usage テーブルの全行(subject_key, amount)
  const allRows = async () =>
    (await owner.query("select subject_key, amount from usage order by subject_key")).rows;

  beforeAll(async () => {
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
      await usage.refundUsage(res.reservation);
      expect(await amount(`u:${sub(u)}`)).toBe(0);
    });

    it("予約した日の行だけを戻す(別の日の行は変えない)", async () => {
      const u = user();
      const res = await usage.reserveUsage(u, "translate_chars", 300);
      if (!res.ok) throw new Error("予約できるはず");
      const otherDay: Reservation = { ...res.reservation, day: "2000-01-01" };
      await usage.refundUsage(otherDay);
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
      const all = anonSubjects.flatMap((a, i) => [a, userSubjects[i]]);

      const settled = await Promise.allSettled(
        all.map((s) => usage.reserveUsage(s, "translate_chars", 100))
      );

      expect(settled.filter((s) => s.status === "rejected")).toEqual([]);

      const results = settled.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof usage.reserveUsage>>>).value);
      const okAll = results.filter((r) => r.ok).length;
      const okAnon = results.filter((r, i) => r.ok && all[i].type === "anon").length;

      expect(okAll).toBe(50);
      expect(await amount("others:*")).toBe(5000);
      expect(await amount("anon:*")).toBe(okAnon > 0 ? okAnon * 100 : null);
      const ipSum = (await owner.query("select coalesce(sum(amount),0)::int s from usage where subject_key like 'ip:%'")).rows[0].s;
      expect(ipSum).toBe(okAnon * 100);
    });

    it("予約と返却が同時に起きても、最終値は(成功した予約 − 返却)と一致する", async () => {
      const u = user();
      vi.stubEnv("USAGE_LIMIT_USER_CHARS", "100000");
      const first = await Promise.all(
        Array.from({ length: 20 }, () => usage.reserveUsage(u, "translate_chars", 100))
      );
      const reservations = first.map((r) => {
        if (!r.ok) throw new Error("予約できるはず");
        return r.reservation;
      });

      await Promise.all([
        ...reservations.map((r) => usage.refundUsage(r)),
        ...Array.from({ length: 20 }, () => usage.reserveUsage(u, "translate_chars", 100)),
      ]);

      expect(await amount(`u:${sub(u)}`)).toBe(2000);
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
      expect(r).toEqual({ remaining: 200, limit: 1000, constrainedBy: "pool" });

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

  describe("ロックの待ち時間(詰まったときは、数秒で諦めて断る)", () => {
    // 引数: 待つ時間(ミリ秒) / 返り値: 指定時間後に完了する Promise
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // 引数: なし / 返り値: 全体の枠の行をロックしたまま保持し、解除用の release を持つオブジェクト(Promise)
    const seedAndLockPool = async () => {
      await owner.query(
        "insert into usage (subject_key, day, kind, amount) values ('others:*', (now() at time zone 'utc')::date, 'translate_chars', 50)"
      );
      const holder = await owner.connect();
      await holder.query("BEGIN");
      await holder.query("select 1 from usage where subject_key = 'others:*' for update");
      return {
        release: async () => {
          try {
            await holder.query("ROLLBACK");
          } finally {
            holder.release();
          }
        },
      };
    };

    it("ロックを待ち切れなければ、例外ではなく busy を返す。待つのは設定した時間だけで、何も消費しない", async () => {
      vi.stubEnv("USAGE_LOCK_TIMEOUT_MS", "1000");
      const lock = await seedAndLockPool();
      const started = Date.now();
      let res: unknown;
      try {
        res = await Promise.race([
          usage.reserveUsage(user(), "translate_chars", 100),
          sleep(8000).then(() => "stuck"),
        ]);
      } finally {
        await lock.release();
      }
      const elapsed = Date.now() - started;

      expect(res).toEqual({ ok: false, reason: "busy" });
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(elapsed).toBeLessThan(6000);
      expect(await amount("others:*")).toBe(50);
      expect(await allRows()).toHaveLength(1);
    });

    it("ロックが外れたあとは、また予約できる", async () => {
      vi.stubEnv("USAGE_LOCK_TIMEOUT_MS", "1000");
      const lock = await seedAndLockPool();
      const first = await usage.reserveUsage(user(), "translate_chars", 100);
      await lock.release();
      expect(first).toEqual({ ok: false, reason: "busy" });

      expect((await usage.reserveUsage(user(), "translate_chars", 100)).ok).toBe(true);
      expect(await amount("others:*")).toBe(150);
    });

    it("短い詰まりなら、待っているうちに解消して、通常どおり予約できる(すぐには諦めない)", async () => {
      vi.stubEnv("USAGE_LOCK_TIMEOUT_MS", "5000");
      const lock = await seedAndLockPool();
      const pending = usage.reserveUsage(user(), "translate_chars", 100);
      await sleep(800);
      await lock.release();

      expect((await pending).ok).toBe(true);
      expect(await amount("others:*")).toBe(150);
    });

    it("返却がロックで詰まっても、例外にならず、数秒で諦める(元の処理を邪魔しない)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubEnv("USAGE_LOCK_TIMEOUT_MS", "1000");
      const lock = await seedAndLockPool();
      const day = (await owner.query("select (now() at time zone 'utc')::date::text as d")).rows[0].d;
      try {
        await expect(
          usage.refundUsage({ keys: ["others:*"], day, kind: "translate_chars", amount: 10 })
        ).resolves.toBeUndefined();
      } finally {
        await lock.release();
      }
      expect(await amount("others:*")).toBe(50);
    });

    it("待ち時間の設定は、そのトランザクションの中だけ(使い回される接続に残らない)", async () => {
      vi.stubEnv("USAGE_LOCK_TIMEOUT_MS", "1000");
      await usage.reserveUsage(user(), "translate_chars", 100);
      const shown = await dbModule.getPool().query("show lock_timeout");
      expect(shown.rows[0].lock_timeout).toBe("0");
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
