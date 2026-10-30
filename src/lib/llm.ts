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
// 出力にはツール呼び出しのJSON(原文+訳)が入り、実測では chunk の文字数の約1.2倍の
// トークンになる。その約1.7倍(2.0倍+256)を上限とし、通常は切れず、暴走したときの
// 出力課金(入力の5倍の単価)が予約の見積もりを大きく超えないようにする。
const MAX_OUTPUT_TOKENS = 8192;
export function maxTokensFor(chunk: string): number {
  return Math.min(MAX_OUTPUT_TOKENS, Math.ceil(chunk.length * 2.0) + 256);
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

// 句読点のない長い文章(PDFから抽出した箇条書きなど)は、1つの「文」が maxChars を超える。
// そのままだと、サーバーが受け付ける最大文字数を超えて翻訳が失敗するので、空白の位置で
// (空白もなければ maxChars で強制的に)分ける。
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

// Split text into chunks of roughly maxChars, breaking at sentence-like boundaries
export function splitIntoChunks(text: string, maxChars = 1500): string[] {
  // Split on sentence-ending punctuation or newlines
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
    // 接続の失敗やタイムアウトは、応答が返らなかっただけで、サーバー側では生成と課金が
    // 進んでいるかもしれない。未課金と言い切れないので、返却させない(安全側)。
    // Claude が拒否した失敗(4xx/5xx・レート制限・過負荷)は未課金なので、そのまま投げて返却させる。
    if (error instanceof Anthropic.APIConnectionError) {
      throw new ClaudeResponseError(`Claude connection failed: ${error.message}`);
    }
    throw error;
  }

  // ここから先は、応答を受け取ったあと(課金済み)。どんな失敗も返却させない。
  try {
    return parseResponse(response, chunk);
  } catch (error) {
    if (error instanceof ClaudeResponseError) throw error;
    throw new ClaudeResponseError(
      `Unexpected error after Claude responded: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseResponse(response: Anthropic.Message, chunk: string): SentencePair[] {
  // 費用の見積もり(1,000文字あたりのトークン数と単価)を実測で見直すためのログ。
  // 本文は出さず、文字数とトークン数だけを残す。
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
