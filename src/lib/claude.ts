import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface SentencePair {
  original: string;
  translation: string;
}

// Clean up raw text: decode HTML entities, remove timestamps, deduplicate
function cleanText(text: string): string {
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
function splitIntoChunks(text: string, maxChars = 1500): string[] {
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

async function processChunk(chunk: string): Promise<SentencePair[]> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are given English text extracted from a document. Your task:

1. Extract unique English sentences or phrases (remove duplicates — the same phrase repeated multiple times should appear only once)
2. Ignore non-English text, timestamps, metadata, headers, or URLs
3. Translate each unique sentence/phrase into natural Japanese

Return ONLY a valid JSON array with no additional text or markdown. Each element should have "original" (English) and "translation" (Japanese).

Example: [{"original": "How are you?", "translation": "お元気ですか？"}]

Text:
${chunk}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }

  let jsonStr = content.text.trim();

  // Remove markdown code block wrapper if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // If response was truncated, try to fix by closing the JSON array
  if (message.stop_reason === "max_tokens") {
    // Find last complete object (ending with })
    const lastCloseBrace = jsonStr.lastIndexOf("}");
    if (lastCloseBrace !== -1) {
      jsonStr = jsonStr.substring(0, lastCloseBrace + 1) + "]";
    }
  }

  return JSON.parse(jsonStr) as SentencePair[];
}

export async function splitAndTranslate(text: string): Promise<SentencePair[]> {
  const cleaned = cleanText(text);
  const chunks = splitIntoChunks(cleaned);
  const results: SentencePair[] = [];

  for (const chunk of chunks) {
    try {
      const pairs = await processChunk(chunk);
      results.push(...pairs);
    } catch (error) {
      console.error("Chunk processing failed, skipping:", error);
      // Continue with other chunks instead of failing entirely
    }
  }

  if (results.length === 0) {
    throw new Error("Failed to process any text chunks");
  }

  // Deduplicate by original text
  const seen = new Set<string>();
  return results.filter((pair) => {
    const key = pair.original.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
