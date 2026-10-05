import { getPool } from "./db";

export interface SaveDocumentSentence {
  position: number;
  original: string;
  translation: string;
}

export interface SaveDocumentInput {
  userId: string;
  title: string;
  sourceType: "pdf" | "txt" | "paste";
  rawText: string;
  sentences: SaveDocumentSentence[];
}

// documents 1行 + sentences N行を1トランザクションで保存する。
// RLSは set_config('app.user_id', ...) をこのトランザクション内で設定することで
// 効かせる(chunk-persistence.prd.md の保存方式どおり)。
export async function saveDocument(input: SaveDocumentInput): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('app.user_id', $1, true)", [input.userId]);

    const result = await client.query<{ document_id: number }>(
      `with new_document as (
         insert into documents (user_id, title, source_type, raw_text)
         values ($1, $2, $3, $4)
         returning id
       )
       insert into sentences (document_id, user_id, position, original, translation)
       select nd.id, $1, s.position, s.original, s.translation
       from new_document nd,
            jsonb_to_recordset($5::jsonb) as s(position int, original text, translation text)
       returning document_id`,
      [input.userId, input.title, input.sourceType, input.rawText, JSON.stringify(input.sentences)]
    );

    await client.query("COMMIT");
    return result.rows[0].document_id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface DocumentSummary {
  id: number;
  title: string;
  sourceType: "pdf" | "txt" | "paste";
  createdAt: string;
  sentenceCount: number;
}

export async function listDocuments(userId: string): Promise<DocumentSummary[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);

    const result = await client.query<{
      id: number;
      title: string;
      source_type: "pdf" | "txt" | "paste";
      created_at: string;
      sentence_count: number;
    }>(
      `select d.id, d.title, d.source_type, d.created_at, count(s.id)::int as sentence_count
       from documents d
       left join sentences s on s.document_id = d.id
       where d.user_id = $1
       group by d.id
       order by d.created_at desc`,
      [userId]
    );

    await client.query("COMMIT");
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      sourceType: row.source_type,
      createdAt: row.created_at,
      sentenceCount: row.sentence_count,
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface DocumentDetail {
  id: number;
  title: string;
  sourceType: "pdf" | "txt" | "paste";
  createdAt: string;
  sentences: { id: number; original: string; translation: string }[];
}

export async function getDocumentWithSentences(
  userId: string,
  documentId: number
): Promise<DocumentDetail | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);

    const docResult = await client.query<{
      id: number;
      title: string;
      source_type: "pdf" | "txt" | "paste";
      created_at: string;
    }>(
      `select id, title, source_type, created_at from documents where id = $1 and user_id = $2`,
      [documentId, userId]
    );
    if (docResult.rows.length === 0) {
      await client.query("COMMIT");
      return null;
    }

    const sentencesResult = await client.query<{
      id: number;
      original: string;
      translation: string;
    }>(
      `select id, original, translation from sentences
       where document_id = $1 and user_id = $2
       order by position asc`,
      [documentId, userId]
    );

    await client.query("COMMIT");
    const doc = docResult.rows[0];
    return {
      id: doc.id,
      title: doc.title,
      sourceType: doc.source_type,
      createdAt: doc.created_at,
      sentences: sentencesResult.rows,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteDocument(userId: string, documentId: number): Promise<boolean> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);

    const result = await client.query(`delete from documents where id = $1 and user_id = $2`, [
      documentId,
      userId,
    ]);

    await client.query("COMMIT");
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
