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
