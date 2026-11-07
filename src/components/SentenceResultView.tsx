"use client";
// カード一覧とシャドーイング用テキストを切り替えて表示するコンポーネント。
// 履歴詳細ページ専用で、状態をこのコンポーネント内で完結させる。

import { useState } from "react";
import SentenceList from "./SentenceList";
import ShadowingSheet from "./ShadowingSheet";
import type { Sentence } from "@/types";

type ResultView = "cards" | "shadowing";

interface SentenceResultViewProps {
  sentences: Sentence[];
}

// 引数: props(sentences: 表示する文の配列) / 返り値: 表示切り替えボタンと選択中のビューのJSX(空ならnull)
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
