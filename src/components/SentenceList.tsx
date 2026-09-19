"use client";

import { useRef } from "react";
import type { Sentence } from "@/types";
import SentenceCard from "./SentenceCard";
import CopyButton from "./CopyButton";
import DownloadPdfButton from "./DownloadPdfButton";

interface SentenceListProps {
  sentences: Sentence[];
}

export default function SentenceList({ sentences }: SentenceListProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  if (sentences.length === 0) return null;

  const allText = sentences
    .map((s) => `${s.original}\n${s.translation}`)
    .join("\n\n");

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
      <div ref={contentRef} className="space-y-3">
        {sentences.map((sentence, i) => (
          <SentenceCard key={sentence.id} sentence={sentence} index={i} />
        ))}
      </div>
    </div>
  );
}
