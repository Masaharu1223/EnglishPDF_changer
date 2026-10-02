"use client";

import { openInOxfordDictionary } from "@/lib/dictionary";

interface ClickableEnglishTextProps {
  text: string;
}

// Splits English text on whitespace and makes each word clickable to look it
// up in Oxford Learner's Dictionaries. Shared by SentenceCard (card view) and
// ShadowingSheet (shadowing script view) so word lookup works in both places.
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
