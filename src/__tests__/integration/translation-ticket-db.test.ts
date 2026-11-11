// 本物のPostgres(Neonのテスト用ブランチ)で、翻訳チケットの発行・使用・返金・保存を確かめる統合テスト。
// DATABASE_URL_TEST_OWNER が未設定なら、このファイルのテストは飛ばされる。

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { resolveTestDb } from "./db-env";

const db = resolveTestDb();

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

describe.skipIf(!db)("translation_tickets(本物のPostgres)", () => {
  let owner: Pool;
  let tickets: typeof import("@/lib/translation-ticket");
  let documents: typeof import("@/lib/documents");
  let dbModule: typeof import("@/lib/db");
  const originalAppUrl = process.env.DATABASE_URL_APP;
  const createdUsers: string[] = [];
  const headers = new Headers();

  // 引数: メールアドレス / 返り値: 作ったテスト用ユーザー(Better Auth のセッションの user と同じ形)
  const createUser = async (email = `${randomUUID()}@example.com`) => {
    const id = `test-${randomUUID()}`;
    await owner.query(
      `insert into users (id, name, email, "emailVerified") values ($1, 'test', $2, true)`,
      [id, email]
    );
    createdUsers.push(id);
    return { id, email, emailVerified: true };
  };
  // 引数: チケット / 返り値: 所有者ロールで直接読んだチケットの行
  const ticketRow = async (ticket: string) =>
    (
      await owner.query("select * from translation_tickets where token_hash = $1", [
        tickets.sha256Hex(ticket),
      ])
    ).rows[0];
  // 引数: ユーザーID / 返り値: そのユーザーの今日の使用量(行がなければ 0)
  const usedToday = async (userId: string): Promise<number> =>
    (
      await owner.query(
        `select amount from usage where subject_key = $1 and day = (now() at time zone 'utc')::date`,
        [`u:${userId}`]
      )
    ).rows[0]?.amount ?? 0;

  const TEXT = "This is the first sentence. This is the second sentence.";

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = db!.appUrl;
    owner = new Pool({ connectionString: db!.ownerUrl });
    tickets = await import("@/lib/translation-ticket");
    documents = await import("@/lib/documents");
    dbModule = await import("@/lib/db");
  });

  afterAll(async () => {
    if (createdUsers.length > 0) {
      await owner.query("delete from users where id = any($1)", [createdUsers]);
      await owner.query("delete from usage where subject_key = any($1)", [
        createdUsers.map((id) => `u:${id}`),
      ]);
    }
    await owner.end();
    await dbModule.getPool().end();
    process.env.DATABASE_URL_APP = originalAppUrl;
  });

  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_SECRET", "integration-test-secret");
    vi.stubEnv("FEATURE_ALLOWED_EMAILS", "");
    vi.stubEnv("USAGE_LIMIT_USER_CHARS", "100000");
    vi.stubEnv("USAGE_LIMIT_OTHERS_TOTAL_CHARS", "100000000");
  });
  afterEach(() => vi.unstubAllEnvs());

  // 引数: ユーザー、本文 / 返り値: 発行したチケットとチャンク
  const issue = async (user: { id: string; email: string; emailVerified: boolean }, text = TEXT) => {
    const result = await tickets.startTranslation(text, user, headers);
    if (!result.ok || !result.ticket) throw new Error("ticket was not issued");
    return { ticket: result.ticket, chunks: result.chunks, usage: result.usage };
  };

  describe("発行", () => {
    it("ハッシュだけを保存し、budget はチャンクの最低課金を含めた合計、期限は24時間後", async () => {
      const user = await createUser();
      const { ticket, chunks } = await issue(user);
      const row = await ticketRow(ticket);

      expect(row.token_hash).not.toBe(ticket);
      expect(row.user_id).toBe(user.id);
      expect(row.subject_type).toBe("user");
      expect(row.budget_chars).toBe(chunks.length * 500);
      expect(row.used_chars).toBe(0);
      expect(row.raw_text_hash).toBe(tickets.sha256Hex(TEXT));
      expect(row.chunk_hashes).toEqual(chunks.map(tickets.sha256Hex));
      const hours = (new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()) / 3_600_000;
      expect(hours).toBeCloseTo(24, 1);
    });

    it("許可リストのユーザーは owner として固定される", async () => {
      const user = await createUser();
      vi.stubEnv("FEATURE_ALLOWED_EMAILS", user.email);
      const { ticket } = await issue(user);
      expect((await ticketRow(ticket)).subject_type).toBe("owner");
    });

    it("残量が budget に足りなければ、チケットを出さない", async () => {
      const user = await createUser();
      vi.stubEnv("USAGE_LIMIT_USER_CHARS", "400");
      const result = await tickets.startTranslation(TEXT, user, headers);
      expect(result.ok && result.ticket).toBeNull();
    });

    it("使えるチケットは、ユーザーごとに最新の10枚まで。11枚目を出すと、一番古いものが消える", async () => {
      const user = await createUser();
      const issued: string[] = [];
      for (let i = 0; i < 11; i++) issued.push((await issue(user)).ticket);

      const count = await owner.query("select count(*)::int as n from translation_tickets where user_id = $1", [
        user.id,
      ]);
      expect(count.rows[0].n).toBe(10);
      expect(await ticketRow(issued[0])).toBeUndefined();
      expect(await ticketRow(issued[10])).toBeDefined();
    });

    it("新しく発行するとき、同じユーザーの使用済みのチケットを消す", async () => {
      const user = await createUser();
      const used = await issue(user);
      await documents.saveDocumentWithTicket(used.ticket, {
        title: "t",
        sourceType: "paste",
        rawText: TEXT,
        sentences: [{ position: 0, original: "a", translation: "b" }],
      });
      await issue(user);
      expect(await ticketRow(used.ticket)).toBeUndefined();
    });

    it("新しく発行するとき、同じユーザーの期限切れのチケットを消す", async () => {
      const user = await createUser();
      const old = await issue(user);
      await owner.query(
        "update translation_tickets set expires_at = now() - interval '1 minute' where token_hash = $1",
        [tickets.sha256Hex(old.ticket)]
      );
      await issue(user);
      expect(await ticketRow(old.ticket)).toBeUndefined();
    });
  });

  describe("翻訳での使用", () => {
    it("チケットの使用文字数と、持ち主の使用量が、同時に加算される", async () => {
      const user = await createUser();
      const { ticket, chunks } = await issue(user);
      const result = await tickets.reserveWithTicket(ticket, chunks[0]);

      expect(result.ok).toBe(true);
      expect((await ticketRow(ticket)).used_chars).toBe(500);
      expect(await usedToday(user.id)).toBe(500);
    });

    it("返金すると、チケットの使用文字数と使用量の両方が戻る", async () => {
      const user = await createUser();
      const { ticket, chunks } = await issue(user);
      const result = await tickets.reserveWithTicket(ticket, chunks[0]);
      if (!result.ok) throw new Error("reserve failed");

      await tickets.refundWithTicket(result);
      expect((await ticketRow(ticket)).used_chars).toBe(0);
      expect(await usedToday(user.id)).toBe(0);
    });

    it("発行時の分割にないチャンクは、無効として断る(使用量も増えない)", async () => {
      const user = await createUser();
      const { ticket } = await issue(user);
      const result = await tickets.reserveWithTicket(ticket, "Another text that was not issued.");

      expect(result).toEqual({ ok: false, reason: "ticket_invalid" });
      expect(await usedToday(user.id)).toBe(0);
    });

    it("budget を超える使い方は断る", async () => {
      const user = await createUser();
      const { ticket, chunks } = await issue(user, "Only one sentence.");
      expect(chunks).toHaveLength(1);
      expect((await tickets.reserveWithTicket(ticket, chunks[0])).ok).toBe(true);
      expect(await tickets.reserveWithTicket(ticket, chunks[0])).toEqual({
        ok: false,
        reason: "ticket_invalid",
      });
    });

    it("期限切れのチケットは断る", async () => {
      const user = await createUser();
      const { ticket, chunks } = await issue(user);
      await owner.query(
        "update translation_tickets set expires_at = now() - interval '1 second' where token_hash = $1",
        [tickets.sha256Hex(ticket)]
      );
      expect((await tickets.reserveWithTicket(ticket, chunks[0])).ok).toBe(false);
    });

    it("知らないチケットは断る", async () => {
      expect(await tickets.reserveWithTicket("unknown", "Hello.")).toEqual({
        ok: false,
        reason: "ticket_invalid",
      });
    });

    it("持ち主の上限に達したら、チケットを使用済みにして、以降は使えない", async () => {
      const user = await createUser();
      const { ticket, chunks } = await issue(user);
      vi.stubEnv("USAGE_LIMIT_USER_CHARS", "100");

      const result = await tickets.reserveWithTicket(ticket, chunks[0]);
      expect(result).toMatchObject({ ok: false, reason: "personal" });
      const row = await ticketRow(ticket);
      expect(row.consumed_at).not.toBeNull();
      expect(row.used_chars).toBe(0);
    });
  });

  describe("保存での使用", () => {
    const doc = (rawText: string) => ({
      title: "test",
      sourceType: "paste" as const,
      rawText,
      sentences: [{ position: 0, original: "This is the first sentence.", translation: "1文目。" }],
    });

    it("チケットの持ち主として保存し、チケットを使用済みにする", async () => {
      const user = await createUser();
      const { ticket } = await issue(user);
      const id = await documents.saveDocumentWithTicket(ticket, doc(TEXT));

      expect(id).not.toBeNull();
      const saved = await owner.query("select user_id from documents where id = $1", [id]);
      expect(saved.rows[0].user_id).toBe(user.id);
      expect((await ticketRow(ticket)).consumed_at).not.toBeNull();
    });

    it("同じチケットで2回目は保存できない", async () => {
      const user = await createUser();
      const { ticket } = await issue(user);
      await documents.saveDocumentWithTicket(ticket, doc(TEXT));
      expect(await documents.saveDocumentWithTicket(ticket, doc(TEXT))).toBeNull();
    });

    it("発行時と違う本文は保存できず、チケットも使用済みにならない", async () => {
      const user = await createUser();
      const { ticket } = await issue(user);
      expect(await documents.saveDocumentWithTicket(ticket, doc("Different text."))).toBeNull();
      expect((await ticketRow(ticket)).consumed_at).toBeNull();
    });

    it("保存に失敗したら(DB の制約違反)、チケットは使用済みにならない", async () => {
      const user = await createUser();
      const { ticket } = await issue(user);
      const broken = { ...doc(TEXT), title: "x".repeat(201) };
      await expect(documents.saveDocumentWithTicket(ticket, broken)).rejects.toThrow();
      expect((await ticketRow(ticket)).consumed_at).toBeNull();
    });

    it("ユーザーを削除すると、チケットも消える", async () => {
      const user = await createUser();
      const { ticket } = await issue(user);
      await owner.query("delete from users where id = $1", [user.id]);
      expect(await ticketRow(ticket)).toBeUndefined();
    });
  });
});
