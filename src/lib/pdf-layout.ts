// PDFの余白(pt。1pt = 1/72インチで、40ptは約14mm)。A4(595×842pt)の上下左右に取る。
export const PDF_MARGIN_PT = 40;

export interface PdfSlice {
  // 元の画像(canvas)から切り出す範囲(px)
  sourceY: number;
  sourceHeight: number;
  // PDFのページ上での高さ(pt)。幅は contentWidthPt で共通
  heightPt: number;
}

export interface PdfLayout {
  contentWidthPt: number;
  slices: PdfSlice[];
}

// 縦長の画像を、余白を除いた領域に収まるページ単位に切り分ける。
// 以前は画像をページ全体に貼り、位置をずらして次のページにも貼り直していた。
// その方式では余白が取れず、余白の部分に隣のページの内容がはみ出して見えてしまうため、
// ページごとに画像を切り出して貼る。
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
  // 1ページに入る画像の高さ(px)。小数を切り捨てて、はみ出さないようにする
  const slicePx = Math.floor(contentHeightPt * pxPerPt);

  const slices: PdfSlice[] = [];
  for (let sourceY = 0; sourceY < canvasHeight; sourceY += slicePx) {
    const sourceHeight = Math.min(slicePx, canvasHeight - sourceY);
    slices.push({ sourceY, sourceHeight, heightPt: sourceHeight / pxPerPt });
  }
  return { contentWidthPt, slices };
}
