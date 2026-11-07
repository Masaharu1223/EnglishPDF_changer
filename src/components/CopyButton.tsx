"use client";
// テキストをクリップボードにコピーするボタン。
// コピー後2秒間だけ表示が「コピーしました」に変わる。

import { useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
}

// 引数: props(text: コピーする文字列, label: ボタンの表示文言) / 返り値: コピーボタンのJSX
export default function CopyButton({ text, label = "コピー" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  // 引数: なし / 返り値: なし(textをクリップボードへコピーする)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error("Failed to copy to clipboard");
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
    >
      {copied ? "コピーしました" : label}
    </button>
  );
}
