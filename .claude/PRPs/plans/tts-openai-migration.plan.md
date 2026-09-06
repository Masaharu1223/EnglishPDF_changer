# Plan: TTS層のOpenAI API化

## Summary
`src/lib/elevenlabs.ts`をOpenAI TTS API(`tts-1`)を呼ぶ`src/lib/tts.ts`に置き換える。フロントエンド(`SentenceCard.tsx`)・APIルートの契約(`POST /api/tts {text} → {audioUrl}`)は変更しない。

## User Story
開発者として、音声生成をOpenAI TTS APIで行いたい。なぜならElevenLabsから、既にClaude API化で足並みを揃えたOpenAIエコシステムに一本化し、料金体系・依存先をシンプルにしたいから。

## Problem → Solution
[現状] ElevenLabs APIで音声生成(`generateSpeech`、素の`fetch`呼び出し) → [解決後] OpenAI TTS API(`tts-1`、`openai`パッケージ経由)で音声生成。返り値の形(`data:audio/mpeg;base64,...`)は変えないため、呼び出し側は無修正で動く

## Metadata
- **Complexity**: Small
- **Source PRD**: `.claude/PRPs/prds/api-pivot-long-form.prd.md`
- **PRD Phase**: Phase 2 - TTS層のOpenAI API化
- **Estimated Files**: 2(`src/lib/tts.ts`新規、`src/app/api/tts/route.ts`更新)。`src/lib/elevenlabs.ts`は削除

---

## UX Design

Internal change — no user-facing UX transformation。`SentenceCard`の再生ボタンの見た目・操作は変わらない。声質・アクセント(アメリカ英語で確定済み)が変わるのみ。

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/elevenlabs.ts` | 1-35(main上) | 置き換え対象そのもの。返り値の形(`data:`URI)を維持する必要がある |
| P0 | `src/app/api/tts/route.ts` | 1-21(main上) | `generateSpeech`を呼ぶ唯一の箇所。関数シグネチャ(`(text: string) => Promise<string>`)を変えないことの根拠 |
| P1 | `src/components/SentenceCard.tsx`(main上のコミット済み内容) | 25-40 | `/api/tts`への実際の呼び出し方(`{text}`を送り`data.audioUrl`を受け取る)を確認済み。**ローカル作業ディレクトリには別件の未コミット変更が入っているため、必ず`git show main:...`でコミット済み内容を見ること**(Phase 1で作業ディレクトリとの差分を見落とした反省) |
| P2 | `package.json` | 1-25 | `openai`パッケージが既に依存関係として存在する(現状はllm.tsから外されたため未使用)ため、追加インストール不要 |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| OpenAI TTS(`audio.speech.create`) | [OpenAI Node SDK examples](https://github.com/openai/openai-node/blob/master/examples/audio.ts) | `openai.audio.speech.create({model, voice, input})`を呼び、返り値に対して`await response.arrayBuffer()`→`Buffer.from(...)`で音声バイナリを取得するパターンが公式 |

```
KEY_INSIGHT: openaiパッケージは既にpackage.jsonにあるが、現状(Phase 1後)llm.tsからは使われなくなっている
APPLIES_TO: 新規importの追加は不要、既存依存の再利用
```

---

## Patterns to Mirror

### API_KEY_GUARD
```js
// SOURCE: src/lib/elevenlabs.ts:4,7-9(main上のコミット済み内容)
const apiKey = process.env.ELEVENLABS_API_KEY;
...
if (!apiKey) {
  throw new Error("ELEVENLABS_API_KEY is not set");
}
```
→ 同じ「未設定なら早期にthrow」パターンを`OPENAI_API_KEY`にも適用する

### AUDIO_TO_DATA_URI
```js
// SOURCE: src/lib/elevenlabs.ts:32-34
const audioBuffer = await response.arrayBuffer();
const base64 = Buffer.from(audioBuffer).toString("base64");
return `data:audio/mpeg;base64,${base64}`;
```
→ この変換ロジックはそのまま流用する(呼び出し元が期待する返り値の形を変えないため)

### ROUTE_ERROR_HANDLING
```js
// SOURCE: src/app/api/tts/route.ts:14-19
} catch (error) {
  console.error("TTS error:", error);
  return NextResponse.json(
    { error: "Failed to generate audio." },
    { status: 500 }
  );
}
```
→ 変更不要。`generateSpeech`が投げるエラーはこのcatchでそのまま処理される

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/tts.ts` | CREATE | OpenAI TTS APIを呼ぶ新実装(Task 1) |
| `src/app/api/tts/route.ts` | UPDATE | import元を`@/lib/elevenlabs`→`@/lib/tts`に変更(Task 2) |
| `src/lib/elevenlabs.ts` | DELETE | 置き換え後、参照されなくなるため削除(Task 2) |

## NOT Building

- `.env.example`の更新(`OPENAI_API_KEY`追加、`ELEVENLABS_API_KEY`削除)はPhase 4のスコープ
- `SentenceCard.tsx`の変更(呼び出し契約が変わらないため不要)
- 声のアクセント切り替え機能(米語のみで確定済み、[[chunk-persistence]]のOpen Questionsで解決済み)
- 音声の一括生成・キャッシュ(on-demand方式を維持、既存PRDの決定通り)

---

## Step-by-Step Tasks

### Task 1: `src/lib/tts.ts`を新規作成(既存の`elevenlabs.ts`はまだ残す)
- **ACTION**: OpenAI TTS APIを呼ぶ新しいファイルを追加する。この時点では`route.ts`からはまだ参照しないため、ビルドは壊れない
- **IMPLEMENT**:
```ts
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TTS_MODEL = process.env.OPENAI_TTS_MODEL ?? "tts-1";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE ?? "alloy";

export async function generateSpeech(text: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const response = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: text,
  });

  const audioBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(audioBuffer).toString("base64");
  return `data:audio/mpeg;base64,${base64}`;
}
```
- **MIRROR**: API_KEY_GUARD(未設定チェック)、AUDIO_TO_DATA_URI(返り値の変換ロジックをそのまま流用)
- **IMPORTS**: `openai`のデフォルトエクスポート(`OpenAI`)
- **GOTCHA**: 関数名`generateSpeech`・シグネチャ`(text: string) => Promise<string>`を`elevenlabs.ts`と完全に一致させること。これにより`route.ts`の変更はimport文1行で済む
- **VALIDATE**: `npx tsc --noEmit`でこの時点(ファイル追加のみ)の型エラーがないか確認。既存の動作(ElevenLabs)はまだ壊れていないはず

### Task 2: `route.ts`の切り替えと`elevenlabs.ts`の削除
- **ACTION**: `route.ts`のimport元を新しいファイルに切り替え、不要になった`elevenlabs.ts`を削除する
- **IMPLEMENT**:
```ts
// src/app/api/tts/route.ts の1箇所だけ変更
import { generateSpeech } from "@/lib/tts";
```
`src/lib/elevenlabs.ts`は削除する。
- **MIRROR**: ROUTE_ERROR_HANDLING(変更不要、そのまま動作する)
- **IMPORTS**: なし(import元パスの変更のみ)
- **GOTCHA**: **`route.ts`はローカル作業ディレクトリと`main`のコミット済み内容が完全一致していることをPhase 2着手前に確認済み**(Phase 1で発生した「作業ディレクトリの見えない差分」の再発防止)。それでも実装直前に`git diff main -- src/app/api/tts/route.ts`で再確認してから着手すること
- **VALIDATE**: `npx tsc --noEmit`でエラーがないこと。`grep -rn "elevenlabs" src/`で参照が残っていないことを確認

---

## Testing Strategy

このプロジェクトには既存の自動テストフレームワークが存在しない(Phase 1と同様)。手動E2E検証のみ行う。

### Edge Cases Checklist
- [ ] 空文字列・非常に短いテキストの音声生成
- [ ] `OPENAI_API_KEY`未設定時に分かりやすいエラーになるか
- [ ] 生成された音声が実際にブラウザで再生できるか(`data:audio/mpeg;base64,...`形式のまま)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: 型エラー0件

### Lint
```bash
npx eslint src/lib/tts.ts src/app/api/tts/route.ts
```
EXPECT: エラー0件

### Build(クリーンな状態で検証、作業ディレクトリの汚染を避ける)
```bash
git archive <branch> | tar -x -C <temp-dir> && cd <temp-dir> && npm install && npm run build
```
EXPECT: ビルド成功。**Phase 1の反省を踏まえ、ローカル作業ディレクトリではなく`git archive`で取り出したクリーンな内容に対して実行すること**

### Manual Validation
- [ ] `.env.local`に`OPENAI_API_KEY`を設定(ユーザー自身の作業。エージェント側はAPIキーを扱わない)
- [ ] `npm run dev`で起動し、有料ティアのカードで再生ボタンを押して音声が再生されることを確認
- [ ] `grep -rn "ELEVENLABS\|elevenlabs" src/`で参照が残っていないことを確認

---

## Acceptance Criteria
- [ ] `src/lib/tts.ts`がOpenAI TTS API経由で動作する
- [ ] `src/app/api/tts/route.ts`の変更はimport文1行のみ
- [ ] `src/lib/elevenlabs.ts`が削除されている
- [ ] `SentenceCard.tsx`は無修正
- [ ] `npm run lint` / `npx tsc --noEmit`がパスする
- [ ] クリーンな(`git archive`で取り出した)状態で`npm run build`が成功する

## Completion Checklist
- [ ] コードは既存パターン(API keyガード、data URI変換、エラーハンドリング)に従っている
- [ ] Task 1・Task 2それぞれの時点でビルドが壊れていない(Phase 1の反省を活かした段階的コミット)
- [ ] ハードコードされた値がない(モデル・声は環境変数で上書き可能)
- [ ] スコープ外(`.env.example`更新、SentenceCard変更、アクセント切替)に手を出していない
- [ ] 自己完結している

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `route.ts`の実装時点の内容が、本プラン作成時の想定(main上のコミット済み内容)と食い違っている | L | H | Task 2実行直前に`git diff main -- src/app/api/tts/route.ts`で再確認する運用をGOTCHAに明記済み |
| OpenAI TTSの声(`alloy`)がElevenLabsの声と印象が異なり、UXが変わったと感じられる可能性 | M | L | 声は環境変数(`OPENAI_TTS_VOICE`)で変更可能な設計にしている。9種類の声から選び直せる |
| `tts-1`の音質がElevenLabsより劣ると感じられる可能性 | L | L | `OPENAI_TTS_MODEL`環境変数で`tts-1-hd`等に切り替え可能な設計にしている |

## Notes
- 声(voice)のデフォルトは`alloy`とした。PRD側に特定の声の指定はなく、9種類ある標準ボイスの中で汎用的に使われる代表的な声として選定。好みが合わなければ`OPENAI_TTS_VOICE`で変更可能
- Phase 1で発生した「ローカル作業ディレクトリとgitコミット済み内容の乖離を見落としてVercelビルドを壊す」というミスを教訓に、本プランでは(1)着手前の`git show main:`での事前確認、(2)ビルドが壊れない順番でのタスク分割、(3)`git archive`によるクリーンな検証、の3点を明示的に手順化した

---
*Generated: 2026-09-06*
