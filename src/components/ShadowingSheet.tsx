"use client";

import { useRef } from "react";
import type { Sentence } from "@/types";
import { buildShadowingLines } from "@/lib/shadowing-sheet";
import CopyButton from "./CopyButton";
import DownloadPdfButton from "./DownloadPdfButton";
import ClickableEnglishText from "./ClickableEnglishText";

interface ShadowingSheetProps {
  sentences: Sentence[];
}

// English-only script for shadowing practice: no Japanese translation, and
// short sentences are grouped onto shared lines (see buildShadowingLines)
// so the sheet reads like a natural script instead of one sentence per line.
export default function ShadowingSheet({ sentences }: ShadowingSheetProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  if (sentences.length === 0) return null;

  const lines = buildShadowingLines(sentences);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <div className="flex justify-end gap-2 mb-4">
        <DownloadPdfButton
          targetRef={contentRef}
          fileName="shadowing-sheet.pdf"
          label="PDFをダウンロード"
        />
        <CopyButton text={lines.join("\n\n")} label="全文をコピー" />
      </div>
      <div ref={contentRef} className="space-y-3">
        {lines.map((line, i) => (
          <p key={i} className="text-gray-900 leading-relaxed">
            <ClickableEnglishText text={line} />
          </p>
        ))}
      </div>
    </div>
  );
}
