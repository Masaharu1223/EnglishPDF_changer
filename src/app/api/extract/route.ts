import { NextRequest, NextResponse } from "next/server";
import { extractTextFromPDF, extractTextFromTXT } from "@/lib/pdf-parser";

export async function POST(request: NextRequest) {
  try {
    const { fileName, fileData } = await request.json();

    if (!fileName || !fileData) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(fileData, "base64");
    const name = fileName.toLowerCase();
    let text: string;

    if (name.endsWith(".pdf")) {
      text = await extractTextFromPDF(buffer);
    } else if (name.endsWith(".txt")) {
      text = extractTextFromTXT(buffer);
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a PDF or TXT file." },
        { status: 400 }
      );
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "No text could be extracted from the file." },
        { status: 400 }
      );
    }

    return NextResponse.json({ text, fileName });
  } catch (error) {
    console.error("Extract error:", error);
    return NextResponse.json(
      { error: "Failed to extract text from file." },
      { status: 500 }
    );
  }
}
