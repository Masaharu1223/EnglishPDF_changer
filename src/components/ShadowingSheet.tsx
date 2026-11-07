"use client";
// シャドーイング練習用の英文のみのスクリプトを表示するコンポーネント。
// 短い文は同じ行にまとめ、コピーとPDF出力ができる。

import { useRef } from "react";
import type { Sentence } from "@/types";
import { buildShadowingLines } from "@/lib/shadowing-sheet";
import CopyButton from "./CopyButton";
import DownloadPdfButton from "./DownloadPdfButton";
import ClickableEnglishText from "./ClickableEnglishText";

interface ShadowingSheetProps {
  sentences: Sentence[];
}

// 引数: props(sentences: 表示する文の配列) / 返り値: シャドーイング用スクリプトのJSX(空ならnull)
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
