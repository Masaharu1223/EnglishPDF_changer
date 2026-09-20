export interface TocGroup {
  start: number;
  end: number;
}

const GROUP_SIZE = 10;
const TOC_THRESHOLD = 100;

// Card lists longer than TOC_THRESHOLD get a jump-to-section index grouped
// in chunks of GROUP_SIZE (e.g. "1-10", "11-20"), since scrolling through
// 100+ cards to find one is slow. Lists at or below the threshold return no
// groups, so the index stays hidden for the common case.
export function buildTocGroups(sentenceCount: number): TocGroup[] {
  if (sentenceCount <= TOC_THRESHOLD) return [];

  const groups: TocGroup[] = [];
  for (let start = 1; start <= sentenceCount; start += GROUP_SIZE) {
    groups.push({ start, end: Math.min(start + GROUP_SIZE - 1, sentenceCount) });
  }
  return groups;
}
