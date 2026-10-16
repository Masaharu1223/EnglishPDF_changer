export interface Sentence {
  id: string;
  original: string;
  translation: string;
  audioUrl?: string;
}

export interface ExtractedText {
  text: string;
  fileName: string;
  fileType: "pdf" | "txt";
}

export interface ProcessingState {
  status: "idle" | "uploading" | "extracting" | "processing" | "generating-audio" | "done" | "error";
  progress?: string;
  error?: string;
  // Chunk-level progress for the "processing" status, so the UI can show
  // "Translating... (3/12 chunks)" instead of a static message while
  // long-form text is translated chunk by chunk (see issue #10).
  completedChunks?: number;
  totalChunks?: number;
}

// GET /api/usage の応答。画面に残量を表示し、機能(音声)を出し分けるために使う。
// 表示のためだけの値で、制限の判定はサーバー側(各APIルート)で別に行う。
export interface UsageInfo {
  loggedIn: boolean;
  capabilities: { tts: boolean };
  translate: {
    // 今日あと何文字まで翻訳できるか(個人の枠と全体の枠のうち、小さいほう)
    remaining: number;
    // 個人の1日の上限
    limit: number;
    // 残りを決めているのが、個人の枠か、全体の枠か
    constrainedBy: "personal" | "pool";
    // 次のリセット(ISO 8601, UTC)
    resetAt: string;
  };
}

