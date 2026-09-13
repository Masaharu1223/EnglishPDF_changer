import { NextRequest, NextResponse } from "next/server";
import { cleanText, processChunk, splitAndTranslate, splitIntoChunks } from "@/lib/llm";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // Chunk-based flow: the client first requests the chunk list ("split"),
    // then translates each chunk one at a time ("translate"), updating the
    // UI as each result comes back. This replaces the old all-at-once
    // request so users see progress on long-form text instead of a single
    // spinner (see issue #10).
    if (action === "split") {
      const { text } = body;
      if (!text || typeof text !== "string") {
        return NextResponse.json({ error: "No text provided" }, { status: 400 });
      }
      const chunks = splitIntoChunks(cleanText(text));
      return NextResponse.json({ chunks });
    }

    if (action === "translate") {
      const { chunk } = body;
      if (!chunk || typeof chunk !== "string") {
        return NextResponse.json({ error: "No chunk provided" }, { status: 400 });
      }
      // No `id` field here on purpose: the client assigns ids as it appends
      // each chunk's results to the running sentence list, so numbering
      // stays contiguous across chunks regardless of how many sentences
      // each chunk happens to produce.
      const sentences = await processChunk(chunk);
      return NextResponse.json({ sentences });
    }

    // Legacy path: process the whole text in one blocking request. Kept for
    // backward compatibility with any other caller of this endpoint.
    const { text } = body;
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const sentences = await splitAndTranslate(text);

    const result = sentences.map((s, i) => ({
      id: `sentence-${i}`,
      original: s.original,
      translation: s.translation,
    }));

    return NextResponse.json({ sentences: result });
  } catch (error) {
    console.error("Process error:", error);
    return NextResponse.json(
      { error: "Failed to process text with Claude." },
      { status: 500 }
    );
  }
}
