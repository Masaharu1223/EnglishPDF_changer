// 履歴に保存できる文書の大きさの上限。保存APIと、翻訳チケットの発行で共用する。

export const MAX_RAW_TEXT_CHARS = 200_000;
export const MAX_TITLE_CHARS = 200;
export const MAX_SENTENCES = 10_000;
export const MAX_ORIGINAL_CHARS = 2_000;
export const MAX_TRANSLATION_CHARS = 4_000;

// 引数: 保存する原文と文の配列 / 返り値: すべての上限に収まっているかどうか
export function fitsDocumentLimits(
  rawText: string,
  sentences: { original: string; translation: string }[]
): boolean {
  return (
    rawText.length >= 1 &&
    rawText.length <= MAX_RAW_TEXT_CHARS &&
    sentences.length >= 1 &&
    sentences.length <= MAX_SENTENCES &&
    sentences.every(
      (s) => s.original.length <= MAX_ORIGINAL_CHARS && s.translation.length <= MAX_TRANSLATION_CHARS
    )
  );
}
