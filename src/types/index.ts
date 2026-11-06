// 画面全体で共有する型定義(例文・抽出テキスト・処理状態・使用量の応答)。

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
  completedChunks?: number;
  totalChunks?: number;
}

export interface UsageInfo {
  loggedIn: boolean;
  capabilities: { tts: boolean };
  translate: {
    remaining: number;
    limit: number;
    minCharge: number;
    constrainedBy: "personal" | "pool";
    resetAt: string;
  };
}

