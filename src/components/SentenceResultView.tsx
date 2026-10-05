"use client";

import { useState } from "react";
import SentenceList from "./SentenceList";
import ShadowingSheet from "./ShadowingSheet";
import type { Sentence } from "@/types";

type ResultView = "cards" | "shadowing";

interface SentenceResultViewProps {
  sentences: Sentence[];
}

// page.tsxのカード一覧/シャドーイング用テキスト切り替えと同じUIパターン。
// page.tsx側はresultViewをsessionStorage永続化にも使っておりstateの持ち方が
// 異なるため、page.tsxは変更せずこちらは履歴詳細ページ専用として自己完結させる。
export default function SentenceResultView({ sentences }: SentenceResultViewProps) {
  const [resultView, setResultView] = useState<ResultView>("cards");

  if (sentences.length === 0) return null;

  return (
    <div className="space-y-8">
      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={() => setResultView("cards")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            resultView === "cards"
              ? "bg-blue-500 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          カード一覧
        </button>
        <button
          type="button"
          onClick={() => setResultView("shadowing")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            resultView === "shadowing"
              ? "bg-blue-500 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          シャドーイング用テキスト
        </button>
      </div>

      {resultView === "cards" ? (
        <SentenceList sentences={sentences} />
      ) : (
        <ShadowingSheet sentences={sentences} />
      )}
    </div>
  );
}
