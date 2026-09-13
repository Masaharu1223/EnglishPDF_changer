// Groups sentences into lines for the shadowing text sheet. Breaking on
// every sentence-ending punctuation mark makes short lines like "Are you
// sure?" or "I'm ready." painfully choppy to read, so instead we accumulate
// whole sentences onto a line until adding the next one would push the line
// past LINE_LENGTH_THRESHOLD, then start a new line.
const LINE_LENGTH_THRESHOLD = 80;

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
