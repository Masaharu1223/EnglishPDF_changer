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
