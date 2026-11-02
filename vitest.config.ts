import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // JSX は vite 8 の既定(oxc、automatic runtime)で変換されるので、個別の設定は要らない
  // (tsconfig の "jsx" には依存しない。vite 7 までは esbuild: { jsx: "automatic" } が必要だった)
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
