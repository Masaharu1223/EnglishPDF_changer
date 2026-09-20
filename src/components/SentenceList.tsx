"use client";

import { useRef } from "react";
import type { Sentence } from "@/types";
import SentenceCard from "./SentenceCard";
import CopyButton from "./CopyButton";
import DownloadPdfButton from "./DownloadPdfButton";
import { buildTocGroups } from "@/lib/sentence-toc";

interface SentenceListProps {
  sentences: Sentence[];
}

function scrollToSentence(start: number) {
  document.getElementById(`sentence-${start}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function SentenceList({ sentences }: SentenceListProps) {
  const contentRef = useRef<HTMLDivElement>(null);

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
        <div className="flex gap-2">
          <DownloadPdfButton
            targetRef={contentRef}
            fileName="extracted-sentences.pdf"
            label="PDFをダウンロード"
          />
          <CopyButton text={allText} label="全文をコピー" />
        </div>
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
      <div ref={contentRef} className="space-y-3">
        {sentences.map((sentence, i) => (
          <SentenceCard key={sentence.id} sentence={sentence} index={i} />
        ))}
      </div>
    </div>
  );
}
