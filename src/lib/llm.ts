import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

// Claude が応答したあとの失敗(解析できない・出力が途中で切れた)。この時点で
// トークンは消費済みなので、呼び出し側は予約した分を返却してはいけない。
// (API呼び出し自体の失敗は、普通の Error のまま。そちらは課金されていない)
export class ClaudeResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeResponseError";
  }
}

// 出力トークンの上限を chunk の長さに合わせる。固定(8192)だと、短い chunk に
// 「長文を書いて」と埋め込まれたとき、1回で大量の出力を課金されてしまう。
// 通常の訳は chunk の文字数の1〜2倍のトークンで収まるので、日本語など
// トークンを多く使う入力も考えて、1文字あたり4トークン+余裕分とする。
const MAX_OUTPUT_TOKENS = 8192;
export function maxTokensFor(chunk: string): number {
  return Math.min(MAX_OUTPUT_TOKENS, chunk.length * 4 + 512);
}

interface SentencePair {
  original: string;
  translation: string;
}

// Tool Use, not the newer Structured Outputs API, because Structured Outputs
// currently only supports Sonnet 4.5/Opus 4.1, not CLAUDE_MODEL's Haiku 4.5.
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

// Clean up raw text: decode HTML entities, remove timestamps, deduplicate
export function cleanText(text: string): string {
  return text
    // Decode HTML entities
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    // Remove timestamp markers like (00:00), (01:03), etc.
    .replace(/\(\d{1,2}:\d{2}\)/g, "")
    // Remove [Music], [Applause], etc.
    .replace(/\[[\w\s]+\]/g, "")
    // Collapse multiple spaces/newlines
    .replace(/\s+/g, " ")
    .trim();
}

// Split text into chunks of roughly maxChars, breaking at sentence-like boundaries
export function splitIntoChunks(text: string, maxChars = 1500): string[] {
  // Split on sentence-ending punctuation or newlines
  const parts = text.split(/(?<=[.!?])\s+/);
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

export async function processChunk(chunk: string): Promise<SentencePair[]> {
  const response = await anthropic.messages.create({
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

  // 費用の見積もり(1,000文字あたりのトークン数と単価)を実測で見直すためのログ。
  // 本文は出さず、文字数とトークン数だけを残す。
  console.info(
    "claude_usage",
    JSON.stringify({
      model: CLAUDE_MODEL,
      chunk_chars: chunk.length,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
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
