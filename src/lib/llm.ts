// Claude を使って英文を文ごとに抽出・日本語訳し、長い文章をチャンクに分ける。
// Claude の応答後の失敗は、課金済みとして区別して扱う。

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

export class ClaudeResponseError extends Error {
  // 引数: エラーメッセージ / 返り値: なし(エラーオブジェクトを初期化する)
  constructor(message: string) {
    super(message);
    this.name = "ClaudeResponseError";
  }
}

const MAX_OUTPUT_TOKENS = 8192;
// 引数: 翻訳する chunk の文字列 / 返り値: 出力トークン数の上限
export function maxTokensFor(chunk: string): number {
  return Math.min(MAX_OUTPUT_TOKENS, Math.ceil(chunk.length * 2.0) + 256);
}

interface SentencePair {
  original: string;
  translation: string;
}

const translateTool: Anthropic.Tool = {
  name: "record_translations",
  description: "Record extracted unique English sentences with their Japanese translations",
  input_schema: {
    type: "object",
    properties: {
      sentences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            original: { type: "string" },
            translation: { type: "string" },
          },
          required: ["original", "translation"],
        },
      },
    },
    required: ["sentences"],
  },
};

// 引数: 生のテキスト / 返り値: HTML エンティティ・タイムスタンプ・[Music] などを除き、空白を詰めたテキスト
export function cleanText(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\(\d{1,2}:\d{2}\)/g, "")
    .replace(/\[[\w\s]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 引数: 1つの長い文、最大文字数 / 返り値: 最大文字数以下に分けた文字列の配列
function splitLongPart(part: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = part;
  while (rest.length > maxChars) {
    const space = rest.lastIndexOf(" ", maxChars);
    const cut = space > 0 ? space : maxChars;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

// 引数: テキスト、1チャンクの最大文字数(省略時1500) / 返り値: 文の区切りで分けたチャンクの配列
export function splitIntoChunks(text: string, maxChars = 1500): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .flatMap((part) => (part.length > maxChars ? splitLongPart(part, maxChars) : [part]));
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    if (current.length + part.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? " " : "") + part;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

// 引数: 翻訳する chunk の文字列 / 返り値: 原文と日本語訳の組の配列
export async function processChunk(chunk: string): Promise<SentencePair[]> {
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokensFor(chunk),
      tools: [translateTool],
      tool_choice: { type: "tool", name: "record_translations" },
      messages: [
        {
          role: "user",
          content: `You are given English text. Extract unique English sentences and translate each to Japanese.

Rules:
- Remove duplicate phrases
- Skip timestamps, URLs, metadata
- Natural Japanese translations

Text:
${chunk}`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionError) {
      throw new ClaudeResponseError(`Claude connection failed: ${error.message}`);
    }
    throw error;
  }

  try {
    return parseResponse(response, chunk);
  } catch (error) {
    if (error instanceof ClaudeResponseError) throw error;
    throw new ClaudeResponseError(
      `Unexpected error after Claude responded: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// 引数: Claude の応答、chunk の文字列 / 返り値: 原文と日本語訳の組の配列(解析できなければ ClaudeResponseError)
function parseResponse(response: Anthropic.Message, chunk: string): SentencePair[] {
  console.info(
    "claude_usage",
    JSON.stringify({
      model: CLAUDE_MODEL,
      chunk_chars: chunk.length,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      stop_reason: response.stop_reason,
    })
  );

  if (response.stop_reason === "max_tokens") {
    throw new ClaudeResponseError("Claude output was cut off (max_tokens)");
  }

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUseBlock) {
    throw new ClaudeResponseError("No tool_use block in Claude response");
  }

  const parsed = toolUseBlock.input as { sentences: SentencePair[] };
  if (!Array.isArray(parsed.sentences)) {
    throw new ClaudeResponseError("Unexpected JSON structure from Claude");
  }
  return parsed.sentences;
}
