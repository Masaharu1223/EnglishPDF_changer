// PDF と TXT のファイルからテキストを取り出す。
// PDF に文字情報がないときは OCR(tesseract.js)で読み取る。

// 引数: PDF のバイナリ / 返り値: 抽出したテキスト(文字がなければ OCR の結果)
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(buffer);
  const text = result.text;

  if (text.trim().length > 0) {
    return text;
  }

  return extractTextWithOCR(buffer);
}

// 引数: PDF のバイナリ / 返り値: OCR で読み取った英語のテキスト
async function extractTextWithOCR(buffer: Buffer): Promise<string> {
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng");
  const { data } = await worker.recognize(buffer);
  await worker.terminate();
  return data.text;
}

// 引数: TXT のバイナリ / 返り値: UTF-8 として読んだテキスト
export function extractTextFromTXT(buffer: Buffer): string {
  return buffer.toString("utf-8");
}
