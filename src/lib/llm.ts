import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

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
    max_tokens: 8192,
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

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUseBlock) {
    throw new Error("No tool_use block in Claude response");
  }

  const parsed = toolUseBlock.input as { sentences: SentencePair[] };
  if (!Array.isArray(parsed.sentences)) {
    throw new Error("Unexpected JSON structure from Claude");
  }
  return parsed.sentences;
}
