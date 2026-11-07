// 縦長の画像を、余白を除いたページ領域に収まる単位に切り分けるレイアウトを計算する。

export const PDF_MARGIN_PT = 40;

export interface PdfSlice {
  sourceY: number;
  sourceHeight: number;
  heightPt: number;
}

export interface PdfLayout {
  contentWidthPt: number;
  slices: PdfSlice[];
}

// 引数: 画像の幅・高さ(px)、ページの幅・高さ(pt)、余白(pt) / 返り値: 内容の幅(pt)とページごとの切り出し範囲
export function computePdfLayout(
  canvasWidth: number,
  canvasHeight: number,
  pageWidthPt: number,
  pageHeightPt: number,
  marginPt: number = PDF_MARGIN_PT
): PdfLayout {
  const contentWidthPt = pageWidthPt - marginPt * 2;
  const contentHeightPt = pageHeightPt - marginPt * 2;
  if (canvasWidth <= 0 || contentWidthPt <= 0 || contentHeightPt <= 0) {
    throw new Error("Invalid PDF layout: margin is too large or canvas is empty");
  }

  const pxPerPt = canvasWidth / contentWidthPt;
  const slicePx = Math.floor(contentHeightPt * pxPerPt);

  const slices: PdfSlice[] = [];
  for (let sourceY = 0; sourceY < canvasHeight; sourceY += slicePx) {
    const sourceHeight = Math.min(slicePx, canvasHeight - sourceY);
    slices.push({ sourceY, sourceHeight, heightPt: sourceHeight / pxPerPt });
  }
  return { contentWidthPt, slices };
}
