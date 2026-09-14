"use client";

import type { Sentence } from "@/types";
import SentenceCard from "./SentenceCard";

interface SentenceListProps {
  sentences: Sentence[];
}

export default function SentenceList({ sentences }: SentenceListProps) {
  if (sentences.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-800">
        Extracted Sentences ({sentences.length})
      </h2>
      {sentences.map((sentence, i) => (
        <SentenceCard key={sentence.id} sentence={sentence} index={i} />
      ))}
    </div>
  );
}
