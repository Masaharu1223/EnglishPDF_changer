import { NextRequest, NextResponse } from "next/server";
import { splitAndTranslate } from "@/lib/claude";

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

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
