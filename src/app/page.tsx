"use client";

import { useEffect, useState } from "react";
import FileUploader from "@/components/FileUploader";
import SentenceList from "@/components/SentenceList";
import ShadowingSheet from "@/components/ShadowingSheet";
import RotatingText from "@/components/RotatingText";
import { useSession } from "@/lib/auth-client";
import type { Sentence, ProcessingState } from "@/types";

type InputMode = "file" | "text";
type ResultView = "cards" | "shadowing";
type SourceType = "pdf" | "txt" | "paste";
type SaveState = "idle" | "saving" | "saved" | "error";

const SENTENCES_STORAGE_KEY = "pdfex:sentences";

export default function Home() {
  const { data: session } = useSession();
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [state, setState] = useState<ProcessingState>({ status: "idle" });
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [textInput, setTextInput] = useState("");
  const [resultView, setResultView] = useState<ResultView>("cards");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Restore results persisted before the last reload. Runs once after
  // mount (not during the initial useState) so the first client render
  // still matches the server-rendered empty state - no hydration mismatch.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SENTENCES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{
        version: number;
        sentences: Sentence[];
        resultView: ResultView;
      }>;
      if (parsed.version === 1 && Array.isArray(parsed.sentences)) {
        setSentences(parsed.sentences);
        if (parsed.resultView === "cards" || parsed.resultView === "shadowing") {
          setResultView(parsed.resultView);
        }
      }
    } catch {
      // Corrupt JSON or storage unavailable (Safari private mode, quota,
      // disabled storage) - just start fresh, same as a first-time visit.
    }
  }, []);

  // Keep persisted results in sync. setSentences([]) at the start of a new
  // run is just another state change, so it clears the old entry too.
  useEffect(() => {
    try {
      if (sentences.length === 0) {
        sessionStorage.removeItem(SENTENCES_STORAGE_KEY);
      } else {
        sessionStorage.setItem(
          SENTENCES_STORAGE_KEY,
          JSON.stringify({ version: 1, sentences, resultView })
        );
      }
    } catch {
      // Best-effort persistence only; ignore quota/private-mode errors.
    }
  }, [sentences, resultView]);

  const isBusy = state.status === "extracting" || state.status === "processing";

  // Shared by file upload and text paste: both end up with a plain string
  // of English text, split it into chunks and translate them one at a
  // time so the sentence list and progress counter update as each result
  // arrives, instead of waiting for the entire document to finish
  // (see issue #10).
  const processText = async (
    text: string,
    meta: { title: string; sourceType: SourceType }
  ) => {
    setSentences([]);
    setSaveState("idle");
    setState({ status: "processing", progress: "Splitting text into chunks..." });

    const splitRes = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "split", text }),
    });
    if (!splitRes.ok) {
      const err = await splitRes.json();
      throw new Error(err.error || "Failed to split text");
    }
    const { chunks } = (await splitRes.json()) as { chunks: string[] };

    // setSentences(prev => ...) only updates state, it doesn't let us read
    // the final list synchronously once the loop ends (stale closure) - so
    // collect the same items into a plain array in parallel for the save
    // call below.
    const collected: Sentence[] = [];

    // Translate chunks sequentially. Deliberately not parallel - running
    // multiple chunks concurrently is a separate future improvement (see
    // api-pivot-long-form.prd.md Phase 3) and out of scope here.
    let nextSentenceIndex = 0;
    for (let i = 0; i < chunks.length; i++) {
      setState({
        status: "processing",
        progress: `Translating... ${Math.round((i / chunks.length) * 100)}% (${i}/${chunks.length} chunks)`,
        completedChunks: i,
        totalChunks: chunks.length,
      });

      try {
        const translateRes = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "translate", chunk: chunks[i] }),
        });
        if (!translateRes.ok) {
          const err = await translateRes.json();
          throw new Error(err.error || "Failed to translate chunk");
        }
        const { sentences: chunkSentences } = (await translateRes.json()) as {
          sentences: { original: string; translation: string }[];
        };

        const newSentences = chunkSentences.map((s) => ({
          id: `sentence-${nextSentenceIndex++}`,
          original: s.original,
          translation: s.translation,
        }));
        collected.push(...newSentences);
        setSentences((prev) => [...prev, ...newSentences]);
      } catch (chunkError) {
        // Skip the failed chunk but keep going, matching the retry-free
        // "log and continue" pattern already used in splitAndTranslate
        // for the legacy bulk path.
        console.error(`Chunk ${i + 1}/${chunks.length} failed, skipping:`, chunkError);
      }
    }

    setState({
      status: "done",
      completedChunks: chunks.length,
      totalChunks: chunks.length,
    });

    // Auto-save to history when logged in. Best-effort: a failed save
    // never turns into a translation error, since the user's results are
    // already shown either way.
    if (session?.user && collected.length > 0) {
      setSaveState("saving");
      try {
        const saveRes = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: meta.title,
            sourceType: meta.sourceType,
            rawText: text,
            sentences: collected.map((s, index) => ({
              position: index,
              original: s.original,
              translation: s.translation,
            })),
          }),
        });
        setSaveState(saveRes.ok ? "saved" : "error");
      } catch (saveError) {
        console.error("Failed to save document:", saveError);
        setSaveState("error");
      }
    }
  };

  const handleFileSelected = async (file: File) => {
    setSentences([]);
    setState({ status: "extracting", progress: "Extracting text from file..." });

    try {
      // Step 1: Extract text from the uploaded file
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

      await processText(text, {
        title: file.name,
        sourceType: file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "txt",
      });
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "An unexpected error occurred",
      });
    }
  };

  const handleTextSubmit = async () => {
    const trimmed = textInput.trim();
    if (!trimmed) return;

    try {
      // ファイルではないので /api/extract は経由せず、貼り付けたテキストをそのまま渡す
      await processText(trimmed, {
        title: trimmed.slice(0, 40),
        sourceType: "paste",
      });
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
              texts={["Sentence Extractor", "例文自動生成機"]}
              interval={3000}
            />
          </h1>
          <p className="text-gray-500 mt-2">
            <RotatingText
              texts={[
                "Upload a PDF/TXT file or paste text to extract English sentences with Japanese translations and audio",
                "PDF/TXTファイルのアップロード、またはテキストの貼り付けから、英文の抽出・日本語翻訳・音声再生ができます",
              ]}
              interval={3000}
            />
          </p>
        </div>

        <div>
          <div className="flex justify-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => setInputMode("file")}
              disabled={isBusy}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                inputMode === "file"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              } ${isBusy ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              ファイルをアップロード
            </button>
            <button
              type="button"
              onClick={() => setInputMode("text")}
              disabled={isBusy}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                inputMode === "text"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              } ${isBusy ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              テキストを貼り付け
            </button>
          </div>

          {inputMode === "file" ? (
            <FileUploader onFileSelected={handleFileSelected} disabled={isBusy} />
          ) : (
            <div className="space-y-3">
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                disabled={isBusy}
                placeholder="英文をここに貼り付けてください(YouTubeの文字起こしなど、長文もそのまま貼り付け可能です)"
                rows={10}
                className="w-full rounded-xl border-2 border-gray-300 p-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={handleTextSubmit}
                disabled={isBusy || !textInput.trim()}
                className="w-full rounded-xl bg-blue-500 text-white font-medium py-3 transition-colors hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-500"
              >
                このテキストを処理する
              </button>
            </div>
          )}
        </div>

        {isBusy && (
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

        {state.status === "done" && sentences.length > 0 && (
          <p className="text-center text-sm text-gray-400">
            {!session?.user
              ? "ログインすると処理結果が履歴として保存されます"
              : saveState === "saving"
                ? "保存中..."
                : saveState === "saved"
                  ? "履歴に保存しました"
                  : saveState === "error"
                    ? "履歴への保存に失敗しました(結果はこのまま表示されています)"
                    : null}
          </p>
        )}

        {sentences.length > 0 && (
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
        )}

        {resultView === "cards" ? (
          <SentenceList sentences={sentences} />
        ) : (
          <ShadowingSheet sentences={sentences} />
        )}
      </div>
    </main>
  );
}
