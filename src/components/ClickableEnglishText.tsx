"use client";
// 英文を単語ごとにクリック可能にし、Oxford Learner's Dictionariesで引けるようにするコンポーネント。
// SentenceCardとShadowingSheetで共用する。

import { openInOxfordDictionary } from "@/lib/dictionary";

interface ClickableEnglishTextProps {
  text: string;
}

// 引数: props(text: 表示する英文) / 返り値: 単語ごとにクリックできるspanの並びのJSX
export default function ClickableEnglishText({ text }: ClickableEnglishTextProps) {
  return (
    <>
      {text.split(/(\s+)/).map((token, i) =>
        /\S/.test(token) ? (
          <span
            key={i}
            onClick={() => openInOxfordDictionary(token)}
            className="cursor-pointer hover:text-blue-600 hover:underline"
            title="Oxford Learner's Dictionariesで調べる"
          >
            {token}
          </span>
        ) : (
          token
        )
      )}
    </>
  );
}
