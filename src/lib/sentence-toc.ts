// 文カードの件数が多いときに表示する、区間ジャンプ用の目次(1-10, 11-20 など)を作る。

export interface TocGroup {
  start: number;
  end: number;
}

const GROUP_SIZE = 10;
const TOC_THRESHOLD = 100;

// 引数: 文の総数 / 返り値: 10件ずつの区間の配列(100件以下なら空配列)
export function buildTocGroups(sentenceCount: number): TocGroup[] {
  if (sentenceCount <= TOC_THRESHOLD) return [];

  const groups: TocGroup[] = [];
  for (let start = 1; start <= sentenceCount; start += GROUP_SIZE) {
    groups.push({ start, end: Math.min(start + GROUP_SIZE - 1, sentenceCount) });
  }
  return groups;
}
