# Plan: LLM層のClaude API化

## Summary
`src/lib/llm.ts`の翻訳処理を、Ollama(OpenAI互換クライアント)からClaude API(`@anthropic-ai/sdk`、Tool Use機能)に置き換える。既存のMarkdownコードブロック除去・truncated JSON修復といった不安定対策コードは、Tool Useによる構造化出力で不要になるため削除する。

## User Story
開発者として、翻訳処理をClaude APIで行いたい。なぜならOllamaのセットアップ負荷・速度・出力不安定性が実運用のボトルネックになっているから。

## Problem → Solution
[現状] Ollama(ローカルLLM)依存で、セットアップの手間・速度不足・出力不安定(JSON崩れ)が課題 → [解決後] Claude API(Haiku 4.5)への切り替えで、セットアップ不要・高速・Tool Useによる構造化出力で安定

## Metadata
- **Complexity**: Small
- **Source PRD**: `.claude/PRPs/prds/api-pivot-long-form.prd.md`
- **PRD Phase**: Phase 1 - LLM層のClaude API化
- **Estimated Files**: 1(`src/lib/llm.ts`)+ ローカル環境変数設定(リポジトリ管理外)

---

## UX Design

Internal change — no user-facing UX transformation。学習カードの見た目・操作は変わらない。翻訳結果の質・速度が変わるのみ。

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/llm.ts` | 1-135 | 変更対象そのもの。既存の関数シグネチャ・エラーメッセージ規約を維持する必要がある |
| P0 | `src/app/api/process/route.ts` | 1-52 | llm.tsの関数(`splitAndTranslate`, `cleanText`, `splitIntoChunks`, `processChunk`)を呼ぶ唯一の箇所。シグネチャを変えないことの根拠 |
| P1 | `.env.example` | full | 環境変数の命名・コメントスタイルの把握(実際の更新はPhase 4) |
| P2 | `package.json` | 1-25 | `@anthropic-ai/sdk`が既に`^0.78.0`でインストール済みであることの確認(追加インストール不要) |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Claude Structured Outputs(ベータ) | [platform.claude.com/docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) | **Sonnet 4.5 / Opus 4.1のみ対応、Haiku 4.5は非対応**。今回選定したHaiku 4.5では使えない |
| Claude Tool Use | 複数ソース([jsonic.io](https://jsonic.io/guides/anthropic-tool-use-json)等) | Tool Use(function calling)は全モデルで使え、ツールの`input_schema`に従った構造化データが`tool_use`ブロックの`input`として返る。文字列JSONのparseが不要 |

```
KEY_INSIGHT: Anthropicの新しい「Structured Outputs」ベータ機能はSonnet 4.5/Opus 4.1限定で、今回選んだHaiku 4.5では使えない
APPLIES_TO: processChunkの実装方式の選択
GOTCHA: 「Structured Outputs」(ベータ、モデル限定)と「Tool Use」(GA、全モデル対応)を混同しない。今回はTool Useを使う
```

---

## Patterns to Mirror

### ERROR_HANDLING
```
// SOURCE: src/lib/llm.ts:78,103
throw new Error("Empty response from Ollama");
...
throw new Error("Unexpected JSON structure from Ollama");
```
→ 同じスタイルで「Ollama」を「Claude」に置き換えたメッセージにする

### CHUNK_LOOP_ERROR_ISOLATION
```js
// SOURCE: src/lib/llm.ts:113-121
for (const chunk of chunks) {
  try {
    const pairs = await processChunk(chunk);
    results.push(...pairs);
  } catch (error) {
    console.error("Chunk processing failed, skipping:", error);
  }
}
```
→ 1チャンクの失敗が全体を止めない設計は維持する。`processChunk`内で新たに例外を投げても、この外側のtry/catchが吸収する

### ENV_VAR_DEFAULT_PATTERN
```js
// SOURCE: src/lib/llm.ts:4,8
baseURL: (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434") + "/v1",
...
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:3b";
```
→ 同じ「環境変数があれば使う、なければデフォルト値」のパターンを`ANTHROPIC_MODEL`(デフォルト: `claude-haiku-4-5-20251001`)にも適用する

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/llm.ts` | UPDATE | `processChunk`の中身をOllama(OpenAIクライアント)呼び出しからAnthropic SDK(Tool Use)呼び出しに置換 |
| `.env.local`(リポジトリ管理外) | UPDATE(開発者ローカルのみ) | 動作確認に`ANTHROPIC_API_KEY`が必要。`.env.example`自体の更新はPhase 4のスコープ |

## NOT Building

- `.env.example`の更新(Phase 4のスコープ)
- `cleanText`/`splitIntoChunks`の変更(現状維持、変更不要)
- `/api/process/route.ts`の変更(関数シグネチャが変わらないため不要)
- TTS(ElevenLabs→OpenAI TTS)の変更(Phase 2のスコープ)
- 並列処理・スライディングウィンドウの実装(Phase 3のスコープ)

---

## Step-by-Step Tasks

### Task 1: Anthropic SDKクライアントの初期化に置き換え
- **ACTION**: llm.ts冒頭のOpenAIクライアント初期化をAnthropicクライアントの初期化に置き換える
- **IMPLEMENT**:
```ts
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
```
- **MIRROR**: ENV_VAR_DEFAULT_PATTERN(既存の`OLLAMA_MODEL`と同じ「env var ?? デフォルト値」の書き方)
- **IMPORTS**: `@anthropic-ai/sdk`のデフォルトエクスポート(`Anthropic`)。`openai`パッケージのimportは削除
- **GOTCHA**: SDKは環境変数`ANTHROPIC_API_KEY`を自動で読むため`apiKey:`は省略可能だが、既存コードの`OLLAMA_BASE_URL`同様に明示した方が挙動が分かりやすいので明示的に渡す
- **VALIDATE**: `npx tsc --noEmit`でこの時点の変更に型エラーがないか確認

### Task 2: Tool定義の追加
- **ACTION**: 翻訳結果を構造化して受け取るためのTool定義を追加する
- **IMPLEMENT**:
```ts
const translateTool: Anthropic.Tool = {
  name: "record_translations",
  description: "Record extracted unique English sentences with their Japanese translations",
  input_schema: {
    type: "object",
    properties: {
      sentences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            original: { type: "string" },
            translation: { type: "string" },
          },
          required: ["original", "translation"],
        },
      },
    },
    required: ["sentences"],
  },
};
```
- **MIRROR**: 既存の`SentencePair`インターフェース(`llm.ts:10-13`)のフィールド名(`original`/`translation`)と完全に一致させる
- **IMPORTS**: 追加importなし(`Anthropic.Tool`型はTask 1のimportから利用)
- **GOTCHA**: `input_schema`のプロパティ名は`sentences`固定。フィールド名が食い違うと呼び出し側で`undefined`になるので要注意
- **VALIDATE**: 型チェックが通ること

### Task 3: processChunkをTool Use呼び出しに置き換え
- **ACTION**: `processChunk`関数の中身を、Ollama向けのchat.completions呼び出しからClaude APIの`messages.create`(Tool Use)呼び出しに置き換える
- **IMPLEMENT**:
```ts
export async function processChunk(chunk: string): Promise<SentencePair[]> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    tools: [translateTool],
    tool_choice: { type: "tool", name: "record_translations" },
    messages: [
      {
        role: "user",
        content: `You are given English text. Extract unique English sentences and translate each to Japanese.

Rules:
- Remove duplicate phrases
- Skip timestamps, URLs, metadata
- Natural Japanese translations

Text:
${chunk}`,
      },
    ],
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUseBlock) {
    throw new Error("No tool_use block in Claude response");
  }

  const parsed = toolUseBlock.input as { sentences: SentencePair[] };
  if (!Array.isArray(parsed.sentences)) {
    throw new Error("Unexpected JSON structure from Claude");
  }
  return parsed.sentences;
}
```
- **MIRROR**: ERROR_HANDLING(Ollama→Claudeに文言を置き換えたError throw)
- **IMPORTS**: なし(Task 1のimportで足りる)
- **GOTCHA**: 旧実装にあった「```json コードブロック除去」「truncated JSON修復」(`llm.ts:83-99`)は**丸ごと削除**する。Tool Useでは`tool_use`ブロックの`input`が既にパース済みオブジェクトとして返るため、文字列JSONのparseや修復ロジックは不要かつ不適合になる
- **VALIDATE**: 既存のPDFサンプルで`npm run dev`を起動し、実際にアップロード→翻訳が最後まで通ることを確認

### Task 4: プロンプトからJSON出力フォーマット指示を削除
- **ACTION**: 旧プロンプト内の「Respond with ONLY this JSON object (no other text): {...}」という指示文を削除する(Tool Useではスキーマで構造が強制されるため不要かつ紛らわしい指示になる)
- **IMPLEMENT**: Task 3のIMPLEMENTブロックに反映済み(プロンプトから該当行を除去したもの)
- **MIRROR**: プロンプトの「Rules」部分(重複除去・タイムスタンプ除外・自然な訳)は既存のロジックをそのまま維持
- **IMPORTS**: なし
- **GOTCHA**: プロンプト指示とTool定義で矛盾した指示を書かないこと
- **VALIDATE**: 生成された翻訳文が過不足なく返っていることを目視確認

---

## Testing Strategy

このプロジェクトには既存の自動テストフレームワークが存在しない(`package.json`の`scripts`は`dev`/`build`/`start`/`lint`のみ、テストファイルなし)。よって本Phaseでは手動E2E検証のみを行う(新たにテストフレームワークは導入しない)。

### Edge Cases Checklist
- [ ] 空のチャンク・極端に短いチャンク(1単語のみ等)
- [ ] 重複文が多いチャンク(dedup動作の確認)
- [ ] タイムスタンプ・URLを含むチャンク(除外ルールの確認)
- [ ] `ANTHROPIC_API_KEY`未設定時に分かりやすいエラーになるか
- [ ] 1チャンクが失敗しても他のチャンクの処理が継続するか(`splitAndTranslate`の既存try/catchが機能するか)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: 型エラー0件

### Lint
```bash
npm run lint
```
EXPECT: エラー0件

### Build
```bash
npm run build
```
EXPECT: ビルド成功。ただし既知の`AuthButton.tsx`構文エラー(本Phaseと無関係の既存バグ)の影響有無は切り分けて確認する

### Manual Validation
- [ ] `.env.local`に`ANTHROPIC_API_KEY`を設定
- [ ] `npm run dev`で起動
- [ ] サンプルPDF(またはテキスト)をアップロードし、抽出→翻訳が最後まで完了することを確認
- [ ] 翻訳結果の日本語訳が自然であることを目視確認(Ollama版と比べて劣化していないか)
- [ ] 意図的に`ANTHROPIC_API_KEY`を外して起動し、エラーメッセージが分かりやすいことを確認

---

## Acceptance Criteria
- [ ] `processChunk`がClaude API(Tool Use)経由で動作する
- [ ] 既存のOllama向け不安定対策コード(markdown除去・truncated JSON修復)が削除されている
- [ ] `cleanText`/`splitIntoChunks`は変更なし
- [ ] `/api/process/route.ts`は変更不要(実際に変更していないことを確認)
- [ ] `npm run lint` / `npx tsc --noEmit` がパスする

## Completion Checklist
- [ ] コードは既存パターン(エラーメッセージスタイル、env var defaultパターン)に従っている
- [ ] チャンク単位のエラー分離(1件失敗しても続行)が維持されている
- [ ] テストは既存に存在しないため手動検証のみで判断(過剰にテストフレームワークを新設しない)
- [ ] ハードコードされた値がない(モデル名は環境変数で上書き可能)
- [ ] スコープ外(TTS、並列化、`.env.example`更新)に手を出していない
- [ ] 自己完結している(実装時に追加でコードベースを探索する必要がない)

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tool Useの`input_schema`とアプリ側が期待するフィールド名(`original`/`translation`)の不一致 | L | M | Task 2で明示的に既存の`SentencePair`型と一致させる設計にしている |
| `max_tokens`(8192)到達時、`tool_use`ブロックが不完全になる可能性 | L | L | 発生時は`toolUseBlock`が見つからずErrorがthrowされ、既存の`splitAndTranslate`のtry/catchでそのチャンクだけスキップされる(現行の挙動を踏襲) |
| Haiku 4.5の翻訳品質がOllama版(qwen2.5等、日本語特化モデル)より劣る可能性 | M | M | PRDのOpen Questionとして残っている。Sonnet 5への切り替えは`ANTHROPIC_MODEL`環境変数のみで可能な設計にしている |

## Notes
- Claude公式の「Structured Outputs」ベータ機能はSonnet 4.5/Opus 4.1限定でHaiku 4.5では使えないため、今回はTool Use(function calling)パターンを採用した。これは全モデルで使える枯れた機能で、Ollama版で必要だった不安定対策コードを不要にできる
- 本Phaseは`api-pivot-long-form.prd.md`のPhase 1に対応。Phase 2(TTS)・Phase 3(長尺対応・並列化)は別途プランを作成する想定

---
*Generated: 2026-09-03*
