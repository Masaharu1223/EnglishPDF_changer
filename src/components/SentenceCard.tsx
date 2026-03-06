"use client";

import { useState, useRef } from "react";
import type { Sentence } from "@/types";

interface SentenceCardProps {
  sentence: Sentence;
  index: number;
}

export default function SentenceCard({ sentence, index }: SentenceCardProps) {
  const [audioUrl, setAudioUrl] = useState<string | undefined>(sentence.audioUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const handlePlay = async () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      return;
    }

    let url = audioUrl;

    if (!url) {
      setIsLoading(true);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sentence.original }),
        });
        if (!res.ok) throw new Error("TTS failed");
        const data = await res.json();
        url = data.audioUrl;
        setAudioUrl(url);
      } catch {
        console.error("Failed to generate audio");
        setIsLoading(false);
        return;
      }
      setIsLoading(false);
    }

    if (url && audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-gray-900 font-medium leading-relaxed">{sentence.original}</p>
          <p className="text-gray-500 mt-2 text-sm leading-relaxed">{sentence.translation}</p>
        </div>
        <button
          onClick={handlePlay}
          disabled={isLoading}
          className={`
            flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors
            ${isLoading ? "bg-gray-100 text-gray-400" : isPlaying ? "bg-red-100 text-red-600 hover:bg-red-200" : "bg-blue-100 text-blue-600 hover:bg-blue-200"}
          `}
          title={isPlaying ? "Stop" : "Play"}
        >
          {isLoading ? (
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : isPlaying ? (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="h-5 w-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>
      <audio
        ref={audioRef}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />
    </div>
  );
}
