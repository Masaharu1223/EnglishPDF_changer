"use client";

import { useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

export default function CopyButton({ text, label = "コピー", className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        // navigator.clipboard requires a secure context; fall back to the
        // classic textarea+execCommand trick when it isn't available.
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy text:", error);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!text}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
        copied
          ? "bg-green-100 text-green-700"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      } disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {copied ? (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          コピーしました
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}
