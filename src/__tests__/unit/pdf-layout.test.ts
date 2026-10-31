import { describe, expect, it } from "vitest";
import { PDF_MARGIN_PT, computePdfLayout } from "@/lib/pdf-layout";

const A4_W = 595.28;
const A4_H = 841.89;

describe("computePdfLayout", () => {
  it("余白を除いた幅を返す", () => {
    const { contentWidthPt } = computePdfLayout(1000, 500, A4_W, A4_H);
    expect(contentWidthPt).toBeCloseTo(A4_W - PDF_MARGIN_PT * 2);
  });

  it("1ページに収まる画像は、1枚のスライスになり、高さは余白内に収まる", () => {
    const { slices } = computePdfLayout(1000, 500, A4_W, A4_H);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({ sourceY: 0, sourceHeight: 500 });
    expect(slices[0].heightPt).toBeLessThanOrEqual(A4_H - PDF_MARGIN_PT * 2);
  });

  it("縦に長い画像は複数ページに分かれ、すき間も重なりもなく全体を覆う", () => {
    const height = 10_000;
    const { slices } = computePdfLayout(1000, height, A4_W, A4_H);
    expect(slices.length).toBeGreaterThan(1);
    let expectedY = 0;
    for (const s of slices) {
      expect(s.sourceY).toBe(expectedY);
      expectedY += s.sourceHeight;
    }
    expect(expectedY).toBe(height);
  });

  it("どのページでも、上下の余白の内側(高さ)に収まる", () => {
    const { slices } = computePdfLayout(1000, 10_000, A4_W, A4_H);
    for (const s of slices) {
      expect(s.heightPt).toBeLessThanOrEqual(A4_H - PDF_MARGIN_PT * 2 + 1e-9);
    }
  });

  it("余白が大きすぎる、または画像が空のときは例外にする", () => {
    expect(() => computePdfLayout(1000, 500, A4_W, A4_H, 300)).toThrow();
    expect(() => computePdfLayout(0, 500, A4_W, A4_H)).toThrow();
  });
});
