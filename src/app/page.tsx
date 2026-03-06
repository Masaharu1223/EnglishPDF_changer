"use client";

import { useState } from "react";
import FileUploader from "@/components/FileUploader";
import SentenceList from "@/components/SentenceList";
import RotatingText from "@/components/RotatingText";
import type { Sentence, ProcessingState } from "@/types";

export default function Home() {
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [state, setState] = useState<ProcessingState>({ status: "idle" });

  const handleFileSelected = async (file: File) => {
    setSentences([]);
    setState({ status: "extracting", progress: "Extracting text from file..." });

    try {
      // Step 1: Extract text
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      const extractRes = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileData: base64 }),
      });
      if (!extractRes.ok) {
        const err = await extractRes.json();
        throw new Error(err.error || "Failed to extract text");
      }
      const { text } = await extractRes.json();

      // Step 2: Split & translate with Claude
      setState({ status: "processing", progress: "Splitting sentences and translating..." });
      const processRes = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!processRes.ok) {
        const err = await processRes.json();
        throw new Error(err.error || "Failed to process text");
      }
      const { sentences: result } = await processRes.json();

      setSentences(result);
      setState({ status: "done" });
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "An unexpected error occurred",
      });
    }
  };

  return (
    <main className="min-h-screen py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">
            <RotatingText
              texts={["Sentence Extractor", "例文エクストラクター"]}
              interval={3000}
            />
          </h1>
          <p className="text-gray-500 mt-2">
            <RotatingText
              texts={[
                "Upload a PDF or TXT file to extract English sentences with Japanese translations and audio",
                "PDFまたはTXTファイルをアップロードして、英文の抽出・日本語翻訳・音声再生ができます",
              ]}
              interval={3000}
            />
          </p>
        </div>

        <FileUploader
          onFileSelected={handleFileSelected}
          disabled={state.status === "extracting" || state.status === "processing"}
        />

        {(state.status === "extracting" || state.status === "processing") && (
          <div className="text-center py-8">
            <svg className="animate-spin h-8 w-8 mx-auto text-blue-500 mb-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-gray-600">{state.progress}</p>
          </div>
        )}

        {state.status === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {state.error}
          </div>
        )}

        <SentenceList sentences={sentences} />
      </div>
    </main>
  );
}
