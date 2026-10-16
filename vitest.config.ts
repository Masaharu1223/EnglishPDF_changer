import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig の "jsx": "preserve" は Next.js 用。テストでは esbuild に JSX を変換させる
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
    // 画面のテスト(ui/)はファイルの先頭に `// @vitest-environment jsdom` を書いて切り替える
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/app/api/**", "src/components/Usage*.tsx", "src/components/SentenceCard.tsx"],
      reporter: ["text-summary", "text"],
    },
  },
});
