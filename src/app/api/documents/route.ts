import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { saveDocument, type SaveDocumentSentence } from "@/lib/documents";

const SOURCE_TYPES = ["pdf", "txt", "paste"] as const;

function isValidSentence(value: unknown): value is SaveDocumentSentence {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.position === "number" &&
    typeof s.original === "string" &&
    typeof s.translation === "string"
  );
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { title, sourceType, rawText, sentences } = body;

  if (typeof title !== "string" || title.length < 1 || title.length > 200) {
    return NextResponse.json({ error: "Invalid title" }, { status: 400 });
  }
  if (!SOURCE_TYPES.includes(sourceType)) {
    return NextResponse.json({ error: "Invalid sourceType" }, { status: 400 });
  }
  if (typeof rawText !== "string" || rawText.length < 1 || rawText.length > 200000) {
    return NextResponse.json({ error: "Invalid rawText" }, { status: 400 });
  }
  if (!Array.isArray(sentences) || sentences.length === 0 || !sentences.every(isValidSentence)) {
    return NextResponse.json({ error: "Invalid sentences" }, { status: 400 });
  }

  try {
    const id = await saveDocument({
      userId: session.user.id,
      title,
      sourceType,
      rawText,
      sentences,
    });
    return NextResponse.json({ id });
  } catch (error) {
    console.error("Document save error:", error);
    return NextResponse.json({ error: "Failed to save document" }, { status: 500 });
  }
}
