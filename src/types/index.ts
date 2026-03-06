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
}
