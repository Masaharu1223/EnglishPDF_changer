# API化 + 長尺コンテンツ(YouTube文字起こし)対応

## Problem Statement

英語教材(PDF/テキスト)を読んでいて意味の分からない表現に出会うたび、意味を調べ、発音を確認する作業に時間がかかる。既存実装はローカルLLM(Ollama)前提で翻訳していたが、セットアップの手間・速度不足・出力の不安定さ(JSON崩れ)がボトルネックになっており、PDF以外の長尺コンテンツ(YouTubeの文字起こしなど)を投入する使い方にも耐えられない。

## Evidence

- `src/lib/llm.ts` に、Ollamaの出力崩れに対応するための markdown コードブロック除去処理・truncated JSON修復処理が実装されている(line 84-97)。これはOllamaの出力安定性が実運用上の課題だったことを示す一次証拠。
- ユーザー自身が「Youtubeの文字起こしされた文章も対象にしたい」「最大1時間程度の内容を想定」と明言(本会話)。
- 1時間の音声は平均発話速度(130〜150 wpm)換算で約4.5〜5万文字、現行チャンクサイズ(1,500文字/`splitIntoChunks`のデフォルト、`llm.ts` line 32)で約30〜35チャンクに相当し、既存の「PDF資料」ユースケース(チャンク10個程度)の3倍以上の規模になる。

## Proposed Solution

翻訳生成をローカルLLM(Ollama)からClaude APIに、音声生成をElevenLabsからOpenAI TTS APIに置き換える。入力経路・チャンク分割・進捗表示UIなど既存の周辺構造はそのまま活かし、LLM/TTSのバックエンド部分のみ差し替える。YouTube文字起こしは自動取得機能を新設せず、既存のテキスト貼り付け経路で受け付ける(ユーザーが別途用意した文字起こしをコピペする運用)。長尺コンテンツについては「1分以内」という目標を文字通り全長さに適用するのではなく、既存のチャンク単位の進捗表示(`page.tsx` line 71-92)を活かして体感速度を担保する方向に調整する。

## Key Hypothesis

We believe Claude API + OpenAI TTS APIへの移行と、既存のチャンク単位進捗表示の活用が、短尺コンテンツ(PDF資料)では1分以内の完了、長尺コンテンツ(最大1時間相当のYouTube文字起こし)では「待たされている感のない」実用的な体験を両立させる。
We'll know we're right when、実際に1時間相当のテキスト(約4.5〜5万文字)を投入した際に最初のチャンクの翻訳結果が数秒〜十数秒以内に表示され始め、最後まで処理が完了することを確認できたとき。

## What We're NOT Building

- **YouTube URLからの自動字幕取得** - 今回はスコープ外。ユーザーが文字起こしを別途用意してテキスト欄に貼り付ける運用とする(会話内で確認済み)
- **アップロード時の音声一括生成** - 既存通りon-demand(各文をクリックした時点で生成)を維持する。長尺コンテンツで音声だけ先に全部作ると時間・コストの負荷が跳ね上がるため(会話内で確認済み)
- **決済機能の実装** - 現状ダミー(`alert()`のみ)のままで、今回のスコープ外
- **Supabase RLSポリシーの厳格化** - 既知の問題として認識しているが、今回のAPI化・長尺対応とは独立した課題のため別対応とする
- **英語以外の言語への対応拡大** - 対象は英語教材のみ

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|---------------|
| 短尺コンテンツ(数千文字程度のPDF)の完了時間 | 1分以内 | 手動計測(投稿〜全チャンク翻訳完了まで) |
| 長尺コンテンツの初回結果表示までの時間 | 数秒〜十数秒以内 | 手動計測(投稿〜最初のチャンクの翻訳結果表示まで) |
| 処理可能な最大長 | 約1時間相当(4.5〜5万文字)のテキストを最後まで処理できる | 実データ(YouTube文字起こし)でのE2Eテスト |

## Open Questions

- [ ] Claude APIのモデル選定(Haiku 4.5 / Sonnet 5)をどちらデフォルトにするか。翻訳品質と速度を実際に比較してから決める
- [ ] OpenAI TTSのモデル選定(`tts-1` / `tts-1-hd` / 他)をどれにするか
- [ ] 逐次処理(現行、`page.tsx` line 71の`for`ループ)のままで長尺コンテンツの完了までの実時間が許容範囲か、限定並列化(例: 同時3〜5チャンク)が必要か。実測してから判断する
- [ ] 1時間相当のテキストを一度に投入した場合のClaude API側のレート制限(RPM/TPM)に抵触しないか。未確認

## Users & Context

**Primary User**
- **Who**: 開発者本人。英語のPDF/テキスト教材、および英語学習用YouTube動画の文字起こしを読む人
- **Current behavior**: 分からない表現を都度調べ、発音を別途確認している
- **Trigger**: 新しい教材(PDFまたは文字起こしテキスト)を読み始めるとき
- **Success state**: アップロードするだけで、日本語訳付き・音声再生可能な学習カード一覧が手に入っている状態

**Job to Be Done**
英語教材(PDFまたはYouTube文字起こし)を読んでいるとき、知らない表現を素早く日本語訳・音声付きで確認したいので、アップロードするだけで学習カード化してくれるツールが欲しい。それにより辞書引きなしで教材を読み進められる。

**Non-Users**
不特定多数向けの商用SaaSは想定していない。英語以外の言語学習も対象外。

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Claude APIによる英文整理+日本語訳生成(チャンク単位) | 既存のOllama依存を解消し、速度・品質・出力安定性を確保するための今回の核心 |
| Must | OpenAI TTS APIによる音声生成(on-demand、既存のElevenLabs呼び出しを置換) | ElevenLabsからの移行。Whisperは音声認識用でありTTSには使えないため、会話内で確認済みの方式 |
| Must | 最大1時間相当(約4.5〜5万文字)のテキストを最後まで処理できること | YouTube文字起こしを想定コンテンツに含めるため |
| Must | 短尺コンテンツは1分以内、長尺は進捗表示で体感速度を担保 | 「1分以内」を全コンテンツ長に一律適用すると長尺で破綻するため、会話内で目標を調整済み |
| Should | 既存のNextAuth認証・Supabase履歴保存・有料/無料ティア | 実装は進んでいるが、今回のAPI化・長尺対応の必須要件ではない |
| Won't | YouTube URLからの自動字幕取得 | 今回は手動貼り付け運用でカバーする(上記参照) |
| Won't | アップロード時の音声一括生成 | on-demand方式を維持するため不要 |

### MVP Scope

`src/lib/llm.ts`のOllama呼び出しをClaude API呼び出しに、`src/lib/elevenlabs.ts`のElevenLabs呼び出しをOpenAI TTS API呼び出しに置き換え、1時間相当のテキストで実際にE2E動作確認が取れている状態。

### User Flow

PDF/テキストをアップロード(または文字起こしテキストを貼り付け) → 抽出(既存、変更なし) → チャンク分割(既存、変更なし) → 各チャンクをClaude APIで英文整理+日本語訳生成、完了したチャンクから順次カード表示 → 各カードで再生ボタンを押すとOpenAI TTS APIで音声生成・再生

---

## Technical Approach

**Feasibility**: HIGH

**Architecture Notes**
- 抽出(`pdf-parse`+OCRフォールバック)・チャンク分割(`splitIntoChunks`, `src/lib/llm.ts` line 32-49)・進捗表示UI(`page.tsx` line 71-92)は既に実装済みで、そのまま流用できる
- フロントエンドは既にチャンクごとに`/api/process`を呼び分けて結果を逐次描画する構造になっている(`page.tsx` line 81-92)ため、Claude API化してもこの構造は変更不要
- TTSは既に`SentenceCard.tsx`(line 61-91)でボタン押下時に`/api/tts`を叩くon-demand方式で実装済み。呼び出し先をOpenAI TTS APIに変えるだけで済む
- `package.json`には`@anthropic-ai/sdk`が既に依存関係として存在する(現状未使用)ため、追加インストール不要
- OpenAI TTS API用に`openai`パッケージが既に依存関係に追加済み(元々Ollama用に追加されたものを流用可能)

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 現行の逐次処理(`for`ループ)のままだと30〜35チャンクの長尺コンテンツで完了まで数分かかる | M | 実測の上で許容できなければ限定並列化(同時実行数を絞ったPromise処理)を検討 |
| 1時間相当のテキストを短時間に大量チャンクでリクエストした場合、Claude APIのレート制限に抵触する可能性 | L〜M | 未検証。実装時にレート制限のドキュメントを確認し、必要ならリトライ/バックオフを実装 |
| Claude APIのJSON出力形式が現行のプロンプト(`processChunk`, `llm.ts` line 55-79)のままで安定するか未検証 | L | Claude APIのstructured output機能を使うことで、Ollama用に書いていた不安定対策コードは簡略化できる見込み |

---

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | LLM層のClaude API化 | `src/lib/llm.ts`のOllama呼び出しをClaude API呼び出しに置換 | pending | with 2 | - | - |
| 2 | TTS層のOpenAI API化 | `src/lib/elevenlabs.ts`相当をOpenAI TTS API呼び出しに置換 | pending | with 1 | - | - |
| 3 | 長尺コンテンツ対応の検証・チューニング | 1時間相当(約4.5〜5万文字)のテキストでE2Eテストし、必要なら並列化を実装 | pending | - | 1 | - |
| 4 | 環境変数・ドキュメント整理 | `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`の設定整理、README更新、Ollama関連コードの扱い(残す/削除)を決定、Issue #2クローズ | pending | - | 1, 2, 3 | - |

### Phase Details

**Phase 1: LLM層のClaude API化**
- **Goal**: 翻訳処理をOllama依存からClaude API依存に切り替える
- **Scope**: `src/lib/llm.ts`の`processChunk`内部をAnthropic SDK呼び出しに変更。`cleanText`/`splitIntoChunks`は変更不要
- **Success signal**: 既存のPDFサンプルで抽出→翻訳が最後まで動作し、結果の日本語訳品質がOllama版と同等以上

**Phase 2: TTS層のOpenAI API化**
- **Goal**: 音声生成をElevenLabs依存からOpenAI TTS API依存に切り替える
- **Scope**: `src/lib/elevenlabs.ts`相当のファイルを新設し、`/api/tts`ルートの呼び出し先を変更
- **Success signal**: `SentenceCard`の再生ボタンから音声が生成・再生される

**Phase 3: 長尺コンテンツ対応の検証・チューニング**
- **Goal**: 1時間相当のYouTube文字起こしテキストでも最後まで処理が完了することを確認する
- **Scope**: 実際の文字起こしテキスト(約4.5〜5万文字)を用意してE2Eテスト。所要時間を計測し、Open Questionsの並列化要否を判断
- **Success signal**: Success Metricsの「処理可能な最大長」「長尺コンテンツの初回結果表示までの時間」を満たす

**Phase 4: 環境変数・ドキュメント整理**
- **Goal**: 移行を完了状態にする
- **Scope**: `.env.example`更新、README更新(既存のOllama手順を「オフライン用の代替手段」として残すか削除するか判断)、Issue #2のクローズ
- **Success signal**: 新規に環境構築する人がREADMEだけでClaude API版をセットアップできる

### Parallelism Notes

Phase 1(LLM層)とPhase 2(TTS層)は別ファイル・別APIを扱うため並行して進められる。Phase 3はPhase 1完了後(翻訳が動く状態)でないと長尺テストができないため直列。Phase 4は全体の後始末なので最後。

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| 翻訳生成の実行環境 | Claude API | ローカルLLM(Ollama、16GB級モデル) | コスト差が誤差レベル(1件数円〜数十円)である一方、速度・出力安定性で明確にAPIが優位。既存の`@anthropic-ai/sdk`資産も活かせる |
| 音声生成の方式 | OpenAI TTS API | ElevenLabs継続 / Whisper | 「Whisper」はSTT(音声認識)用でありTTSには使えないと判明したため、代替としてOpenAI TTS APIに決定 |
| YouTube文字起こしの取り込み方法 | 既存のテキスト貼り付け欄を流用 | URL貼り付けで自動字幕取得 | 新規実装コストを避け、v1のスコープを絞るため |
| 音声生成のタイミング | on-demand(既存方式を維持) | アップロード時に全文一括生成 | 長尺コンテンツでの時間・コスト負荷を避けるため |
| 長尺コンテンツでのパフォーマンス目標 | コンテンツ長に応じて調整(短尺は1分以内、長尺は進捗表示で体感速度担保) | 長さに関係なく一律1分以内 | 1時間相当は30〜35チャンクにのぼり、一律1分以内は非現実的なため |

---

## Research Summary

**Market Context**

個人利用が主目的のツールであるため、今回は競合調査を実施していない(優先度低と判断)。将来ポートフォリオとして公開する際に、DeepL+Anki連携やLingQ等の既存の語学学習ツールとの位置づけを整理する余地がある。

**Technical Context**

- `src/lib/llm.ts`: チャンク分割・クリーニングロジックは非LLM(正規表現・文字数ベース)で実装済み。LLM呼び出しは`processChunk`関数のみに閉じている
- `src/app/api/process/route.ts`: `split`/`translate`の2アクションに分かれており、チャンク単位での逐次呼び出しをフロントエンドがコントロールする設計
- `src/app/page.tsx`(line 71-92): チャンクごとに`/api/process`を呼び、完了したチャンクから順次結果をUIに反映する進捗表示が既に実装済み
- `src/components/SentenceCard.tsx`(line 61-91): 音声再生はボタン押下時のon-demand生成。Web Speech API(無料)とElevenLabs API(有料、`/api/tts`経由)の2系統が既にある
- `package.json`: `@anthropic-ai/sdk`(未使用)と`openai`(現在Ollama呼び出しに使用中)が既に依存関係にあり、追加インストールなしで着手可能

---

*Generated: 2026-08-31*
*Status: DRAFT - needs validation*
