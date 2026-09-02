# 単語クリックで英語の定義を表示

## Problem Statement

学習カードの英文を読んでいて意味の分からない単語に出会うたびに、別の辞書アプリ・サイトを開いて調べる必要があり、学習の流れが中断される。

## Evidence

- ユーザーが「単語をクリックするとOxfordの英語での定義が出てくる仕様にしたい」と要望(本会話)
- 現状の`src/components/SentenceCard.tsx`(line 109)は英文全体を1つの`<p>`要素としてプレーンテキスト表示しており、単語単位のクリックは未実装

## Proposed Solution

英文を単語単位の`<span>`に分割してクリック可能にし、クリックした単語をそのままの形で無料のFree Dictionary API(dictionaryapi.dev)に問い合わせ、ポップアップで英語の定義を表示する。活用形の正規化(原形変換)は行わず、見つからない場合は「定義が見つかりませんでした」と表示する。

## Key Hypothesis

We believe 単語クリックでその場に英語の定義が表示されることが、学習中の中断(辞書サイトを別途開く手間)を減らすと信じている。
We'll know we're right when、実際の学習カードで単語をクリックし、タブ切り替えなどの追加操作なしに定義を確認できる状態になったとき。

## What We're NOT Building

- **活用形の正規化(原形変換)** - シンプルさ優先で今回は見送り(会話内で決定)。ヒット率が低ければ次イテレーションで検討
- **品詞・発音記号・例文・類義語の表示** - 定義のみのシンプル表示とする(会話内で決定)。dictionaryapi.devからは取得可能なので将来追加は容易
- **Oxford公式APIの採用** - 月額£50〜(年間契約)のコストが個人開発の方針に見合わないため不採用(会話内で確認済み)

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|---------------|
| 定義取得の応答時間 | クリックから2秒以内に定義またはエラー表示 | 手動計測 |
| 基本語彙のヒット率 | 学習教材で頻出する基本的な単語で定義が見つかる | サンプル教材でのE2E確認 |

## Open Questions

- [ ] dictionaryapi.devがカバーしていない単語(固有名詞・専門用語・活用形)の実際のヒット率はどの程度か。実装して使ってみないと分からない
- [ ] 同じ単語をキャッシュするか(localStorageまたはサーバー側)。API提供元が「重いトラフィックが見込まれるならキャッシュ推奨」と案内している
- [ ] ポップアップのUI配置(クリックした単語の直下か、カード内の固定位置か)

## Users & Context

**Primary User**
- **Who**: 開発者本人。英語のPDF/テキスト教材・YouTube文字起こしを読む人([[api-pivot-long-form]]と共通)
- **Current behavior**: 分からない単語に出会うたびに別の辞書アプリ・サイトで調べている
- **Trigger**: 学習カードの英文を読んでいて分からない単語に出会ったとき
- **Success state**: その場でクリックするだけで英語の定義が確認できている

**Job to Be Done**
学習カードの英文を読んでいるとき、分からない単語の意味をその場で確認したいので、クリックするだけで英語の定義が見られるようにしたい。それにより別アプリに切り替えることなく学習を続けられる。

**Non-Users**
日本語訳での単語単位の意味表示は対象外(あくまで英語での定義)。

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | 英文中の単語をクリック可能にする(単語単位のspan分割) | 機能の前提となる土台 |
| Must | クリックした単語をそのままの形でFree Dictionary APIに問い合わせ、英語の定義をポップアップ表示 | 要望の核心機能 |
| Must | 定義が見つからない場合に「定義が見つかりませんでした」と表示 | エラー時も学習体験を止めないため |
| Should | 同じ単語の検索結果をキャッシュ(重複リクエスト削減) | API提供元の推奨に沿う、体感速度向上 |
| Won't | 活用形の正規化(原形変換) | シンプルさ優先(決定済み) |
| Won't | 品詞・発音記号・例文の表示 | シンプルさ優先(決定済み) |

### MVP Scope

`SentenceCard`の英文を単語spanに分割してクリックイベントを付け、新設する`/api/dictionary`ルート経由でdictionaryapi.devから定義を取得し、ポップアップ表示する。

### User Flow

学習カードの英文中の単語をクリック → ポップアップで英語の定義が表示される(見つからなければその旨表示) → ポップアップの外をクリックすると閉じる

---

## Technical Approach

**Feasibility**: HIGH

**Architecture Notes**
- `src/components/SentenceCard.tsx`(line 109)は現状英文を1つの`<p>`要素で描画している。単語ごとに`<span onClick>`へ分割する変更が必要
- 新規に`/api/dictionary`ルートを追加し、`https://api.dictionaryapi.dev/api/v2/entries/en/{word}`を呼び出すサーバー側プロキシとする(APIキー不要、認証不要)
- 既存の`/api/tts`ルート(外部APIをサーバー側でプロキシするパターン)をそのまま踏襲できる

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| dictionaryapi.devは公式SLAのない無料サービスで、可用性・継続性の保証がない | M | 個人利用なので許容。呼び出し部分を`/api/dictionary`に閉じ込め、将来Merriam-Webster API等へ切り替えやすい構造にする |
| 活用形をそのまま検索するため、動詞の活用形・複数形などでヒットしない単語が多い可能性 | M | 会話内の決定通り今回は許容し、「見つかりませんでした」で対応。ヒット率が低ければ次イテレーションで原形変換を追加検討 |

---

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | `/api/dictionary`ルート追加 | dictionaryapi.devへのサーバー側プロキシを実装 | pending | with 2 | - | - |
| 2 | 単語クリックUIの実装 | `SentenceCard.tsx`の英文を単語spanに分割し、クリックイベントを追加 | pending | with 1 | - | - |
| 3 | 定義ポップアップの実装 | クリック時に1・2を繋ぎ、ポップアップで定義(または未検出メッセージ)を表示 | pending | - | 1, 2 | - |
| 4 | キャッシュの実装 | 同一単語の再検索をキャッシュして重複リクエストを削減 | pending | - | 3 | - |

### Phase Details

**Phase 1: `/api/dictionary`ルート追加**
- **Goal**: 単語を渡すと英語の定義を返すサーバー側エンドポイントを用意する
- **Scope**: dictionaryapi.devへのプロキシ実装、404(未検出)時のハンドリング
- **Success signal**: 既知の単語で定義が、未知の単語で「見つからない」旨のレスポンスが返る

**Phase 2: 単語クリックUIの実装**
- **Goal**: 英文中の各単語をクリック可能にする
- **Scope**: `SentenceCard.tsx`の英文表示を単語ごとの`<span>`に分割し、クリックイベントを付与
- **Success signal**: 任意の単語をクリックするとイベントが発火する(この時点では定義取得は未接続でも可)

**Phase 3: 定義ポップアップの実装**
- **Goal**: クリック→定義取得→表示までを繋ぐ
- **Scope**: Phase 1・2を接続し、ポップアップUIで結果を表示。ローディング状態・未検出時のメッセージも含む
- **Success signal**: 実際の学習カードで単語をクリックして定義が表示される

**Phase 4: キャッシュの実装**
- **Goal**: 同じ単語への重複リクエストを避ける
- **Scope**: 検索済み単語をメモリ内(またはlocalStorage)にキャッシュ
- **Success signal**: 同じ単語を2回目以降クリックした際に追加のAPIリクエストが発生しない

### Parallelism Notes

Phase 1(APIルート)とPhase 2(UI分割)は別ファイルで独立して進められるため並行可能。Phase 3は両方の完成後、Phase 4は最後の最適化として位置づける。

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| 辞書データソース | Free Dictionary API(dictionaryapi.dev) | Oxford Dictionaries API公式 / Merriam-Webster API | Oxford公式は月額£50〜で個人開発には高すぎる。ユーザーも「ちゃんとした英英定義であればブランドにはこだわらない」と確認済み |
| 活用形の扱い | クリックした形のままで検索 | 原形に正規化してから検索 | シンプルさ優先、実装コストを抑えるための決定 |
| 表示情報 | 定義のみ | 品詞・発音記号も含む | シンプルさ優先の決定 |

---

## Research Summary

**Market Context**

個人利用が主目的のツールのため、今回も競合調査は実施していない(優先度低と判断)。

**Technical Context**

- Free Dictionary API(dictionaryapi.dev)はAPIキー不要・現時点でレート制限なし・無料。ただし提供元が重いトラフィック時のキャッシュ推奨を明記しており、公式SLAはない
- Oxford Dictionaries API公式は月額£50(API Lite、年間契約)からで、個人開発のコスト方針(月数十〜数百円)には見合わない
- `SentenceCard.tsx`(line 109)は現状英文を単一の`<p>`要素で描画しており、単語単位のクリックには分割変更が必要

---

*Generated: 2026-08-31*
*Status: DRAFT - needs validation*
