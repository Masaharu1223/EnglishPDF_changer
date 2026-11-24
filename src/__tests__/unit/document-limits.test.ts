// 履歴に保存できる大きさの確認(fitsDocumentLimits)をテストする。境界の値で、通るものと断るものを確かめる。
import { describe, expect, it } from "vitest";
import {
  fitsDocumentLimits,
  MAX_ORIGINAL_CHARS,
  MAX_RAW_TEXT_CHARS,
  MAX_SENTENCES,
  MAX_TRANSLATION_CHARS,
} from "@/lib/document-limits";

const one = [{ original: "Hi.", translation: "やあ。" }];

describe("fitsDocumentLimits", () => {
  it("上限ちょうどは通す", () => {
    expect(
      fitsDocumentLimits("a".repeat(MAX_RAW_TEXT_CHARS), [
        { original: "a".repeat(MAX_ORIGINAL_CHARS), translation: "あ".repeat(MAX_TRANSLATION_CHARS) },
      ])
    ).toBe(true);
    expect(fitsDocumentLimits("a", Array(MAX_SENTENCES).fill(one[0]))).toBe(true);
  });

  it.each([
    ["原文が空", "", one],
    ["原文が長すぎる", "a".repeat(MAX_RAW_TEXT_CHARS + 1), one],
    ["文が0個", "a", []],
    ["文が多すぎる", "a", Array(MAX_SENTENCES + 1).fill(one[0])],
    ["英文が長すぎる", "a", [{ original: "a".repeat(MAX_ORIGINAL_CHARS + 1), translation: "訳" }]],
    ["訳が長すぎる", "a", [{ original: "a", translation: "あ".repeat(MAX_TRANSLATION_CHARS + 1) }]],
  ])("%s なら断る", (_label, rawText, sentences) => {
    expect(fitsDocumentLimits(rawText as string, sentences as typeof one)).toBe(false);
  });
});
