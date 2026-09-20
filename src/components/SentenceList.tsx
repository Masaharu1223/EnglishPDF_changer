"use client";

import type { Sentence } from "@/types";
import SentenceCard from "./SentenceCard";
import CopyButton from "./CopyButton";
import { buildTocGroups } from "@/lib/sentence-toc";

interface SentenceListProps {
  sentences: Sentence[];
}

function scrollToSentence(start: number) {
  document.getElementById(`sentence-${start}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function SentenceList({ sentences }: SentenceListProps) {
  if (sentences.length === 0) return null;

  const allText = sentences
    .map((s) => `${s.original}\n${s.translation}`)
    .join("\n\n");
  const tocGroups = buildTocGroups(sentences.length);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">
          Extracted Sentences ({sentences.length})
        </h2>
        <CopyButton text={allText} label="全文をコピー" />
      </div>
      {tocGroups.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tocGroups.map((group) => (
            <button
              key={group.start}
              type="button"
              onClick={() => scrollToSentence(group.start)}
              className="px-3 py-1 text-sm font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              {group.start}-{group.end}
            </button>
          ))}
        </div>
      )}
      {sentences.map((sentence, i) => (
        <SentenceCard key={sentence.id} sentence={sentence} index={i} />
      ))}
    </div>
  );
}
