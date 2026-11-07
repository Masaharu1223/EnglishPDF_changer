"use client";
// 2つの文言を一定間隔で切り替えて表示するコンポーネント。
// 切り替え時のアニメーション用にクラスを付け替える。

import { useState, useEffect } from "react";

interface RotatingTextProps {
  texts: [string, string];
  interval?: number;
  className?: string;
}

// 引数: props(texts: 切り替える2つの文言, interval: 切り替え間隔ms, className: 追加クラス) / 返り値: 切り替え表示のJSX
export default function RotatingText({ texts, interval = 3000, className = "" }: RotatingTextProps) {
  const [index, setIndex] = useState(0);
  const [isFlipping, setIsFlipping] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setIsFlipping(true);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % 2);
        setIsFlipping(false);
      }, 300);
    }, interval);

    return () => clearInterval(timer);
  }, [interval]);

  return (
    <span className={`rotating-text-wrapper ${className}`}>
      {texts.map((text, i) => (
        <span
          key={i}
          aria-hidden={i !== index}
          className={`rotating-text ${
            i !== index ? "rotating-hidden" : isFlipping ? "rotating-out" : "rotating-in"
          }`}
        >
          {text}
        </span>
      ))}
    </span>
  );
}
