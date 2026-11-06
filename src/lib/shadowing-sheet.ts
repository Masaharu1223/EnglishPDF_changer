// シャドーイング用のテキストシートのために、文を行にまとめる。

const LINE_LENGTH_THRESHOLD = 80;

// 引数: 原文を持つ文の配列、1行の最大文字数(省略時80) / 返り値: 文を詰めて作った行の配列
export function buildShadowingLines(
  sentences: { original: string }[],
  threshold = LINE_LENGTH_THRESHOLD
): string[] {
  const lines: string[] = [];
  let current = "";

  for (const { original } of sentences) {
    const text = original.trim();
    if (!text) continue;

    if (current && current.length + 1 + text.length > threshold) {
      lines.push(current);
      current = text;
    } else {
      current = current ? `${current} ${text}` : text;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}
