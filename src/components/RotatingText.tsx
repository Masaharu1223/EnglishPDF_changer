"use client";

import { useState, useEffect } from "react";

interface RotatingTextProps {
  texts: [string, string];
  interval?: number;
  className?: string;
}

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
      <span className={`rotating-text ${isFlipping ? "rotating-out" : "rotating-in"}`}>
        {texts[index]}
      </span>
    </span>
  );
}
