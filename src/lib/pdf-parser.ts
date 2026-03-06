export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(buffer);
  const text = result.text;

  if (text.trim().length > 0) {
    return text;
  }

  // If no text extracted, attempt OCR
  return extractTextWithOCR(buffer);
}

async function extractTextWithOCR(buffer: Buffer): Promise<string> {
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng");
  const { data } = await worker.recognize(buffer);
  await worker.terminate();
  return data.text;
}

export function extractTextFromTXT(buffer: Buffer): string {
  return buffer.toString("utf-8");
}
