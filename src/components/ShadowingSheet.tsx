"use client";

import type { Sentence } from "@/types";
import { buildShadowingLines } from "@/lib/shadowing-sheet";

interface ShadowingSheetProps {
  sentences: Sentence[];
}

// English-only script for shadowing practice: no Japanese translation, and
// short sentences are grouped onto shared lines (see buildShadowingLines)
// so the sheet reads like a natural script instead of one sentence per line.
export default function ShadowingSheet({ sentences }: ShadowingSheetProps) {
  if (sentences.length === 0) return null;

  const lines = buildShadowingLines(sentences);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <div className="space-y-3">
        {lines.map((line, i) => (
          <p key={i} className="text-gray-900 leading-relaxed">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
