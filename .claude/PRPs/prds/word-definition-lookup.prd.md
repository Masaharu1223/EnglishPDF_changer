# 単語クリックで外部英英辞書サイトを開く

> **Status: ACTIVE**(2026-09-13)。当初はアプリ内にAPIから定義を取得してポップアップ表示する設計だったが、シンプルさを優先し外部辞書サイトへのリンク遷移に方針変更した([Issue #11](https://github.com/Masaharu1223/EnglishPDF_changer/issues/11)関連の協議で決定)。

## Problem Statement

学習カードの英文を読んでいて意味の分からない単語に出会うたびに、別の辞書アプリ・サイトを開いて調べる必要があり、学習の流れが中断される。

## Evidence

- ユーザーが「単語をクリックするとOxfordの英語での定義が出てくる仕様にしたい」と要望(当初の会話)
- 現状の`src/components/SentenceCard.tsx`は英文全体を1つの`<p>`要素としてプレーンテキスト表示しており、単語単位のクリックは未実装
- 2026-09-13の協議で、アプリ内に定義をポップアップ表示するのではなく、外部の英英辞書サイトを新しいタブで開く方式に変更する決定がされた

## Proposed Solution

英文を単語単位の`<span>`に分割してクリック可能にする。クリックした単語をそのままの形でURLに埋め込み、外部の英英辞書サイト(Oxford Learner's Dictionaries)を新しいタブで開く。アプリ側で辞書APIを呼んだり定義を保持したりはしない。

## Key Hypothesis

We believe 単語クリックで外部辞書サイトへすぐ遷移できることが、学習中の中断(手動で辞書サイトを開いて単語を検索し直す手間)を減らすと信じている。
We'll know we're right when、実際の学習カードで単語をクリックし、検索窓に単語を打ち込み直すことなく該当語の辞書ページが開く状態になったとき。

## What We're NOT Building

- **アプリ内での定義表示(ポップアップ)** - 当初の設計だったが、実装コストとメンテナンス対象を減らすため不採用に変更(2026-09-13決定)
- **辞書API(dictionaryapi.dev等)の呼び出し** - 上記方針変更に伴い不要。サーバー側プロキシ・キャッシュも不要
- **活用形の正規化(原形変換)** - 外部辞書サイト自身の検索機能に委ねる。多くの辞書サイトは活用形でもある程度サジェストしてくれるため、アプリ側での対応は行わない
- **品詞・発音記号・例文・類義語の表示** - 外部サイト側に既に用意されているため、アプリ側では持たない

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|---------------|
| 遷移までの操作数 | クリック1回で辞書ページが開く | 手動確認 |
| 検索対象の一致率 | クリックした単語がそのまま検索欄に反映された状態でページが開く | 手動確認 |

## Open Questions

- [ ] 外部辞書サイトの選定(Oxford Learner's Dictionaries を仮決定。Cambridge Dictionary等の代替候補もあり)
- [ ] 別タブで開くか、同一タブで開くか(別タブ推奨、学習の流れを止めないため)

## Users & Context

**Primary User**
- **Who**: 開発者本人。英語のPDF/テキスト教材・YouTube文字起こしを読む人([[api-pivot-long-form]]と共通)
- **Current behavior**: 分からない単語に出会うたびに別の辞書アプリ・サイトを開き、手動で単語を検索している
- **Trigger**: 学習カードの英文を読んでいて分からない単語に出会ったとき
- **Success state**: 単語をクリックするだけで、その単語の辞書ページがすぐに開く

**Job to Be Done**
学習カードの英文を読んでいるとき、分からない単語の意味をすぐ調べたいので、クリックするだけで該当単語の辞書ページを開けるようにしたい。それにより辞書サイトを開いて単語を打ち込み直す手間を省ける。

**Non-Users**
日本語訳での単語単位の意味表示は対象外(あくまで英語での定義を外部サイトで確認する用途)。

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | 英文中の単語をクリック可能にする(単語単位のspan分割) | 機能の前提となる土台 |
| Must | クリックした単語で外部英英辞書サイトを新しいタブで開く | 要望の核心機能。シンプルさ優先で確定した方式 |
| Won't | アプリ内でのAPI呼び出し・定義表示・キャッシュ | 方針変更により不要 |

### MVP Scope

`SentenceCard`の英文を単語spanに分割してクリックイベントを付け、クリック時に`window.open()`で外部辞書サイトのURL(単語をクエリ/パスパラメータとして埋め込み)を新しいタブで開く。

### User Flow

学習カードの英文中の単語をクリック → 新しいタブで外部辞書サイトの該当単語のページが開く

---

## Technical Approach

**Feasibility**: HIGH(当初案よりさらに簡易)

**Architecture Notes**
- `src/components/SentenceCard.tsx`は現状英文を1つの`<p>`要素で描画している。単語ごとに`<span onClick>`へ分割する変更が必要(この部分は当初案から変更なし)
- サーバー側の新規実装は不要(APIルート・プロキシ不要)。クリック時に`window.open("https://www.oxfordlearnersdictionaries.com/definition/english/" + encodeURIComponent(word), "_blank")`のようなクライアントサイドのみの実装で完結する

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 外部辞書サイトのURL構造が変わった場合にリンクが壊れる | L | 個人利用なので許容。サイト構造が変わった場合はURLパターンを更新するのみ |
| 活用形の単語(running等)で辞書サイト側が該当ページを見つけられない場合がある | M | 外部サイト側の検索・サジェスト機能に委ねる。アプリ側では対応しない(方針決定済み) |

---

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | 単語クリックUIの実装 | `SentenceCard.tsx`の英文を単語spanに分割し、クリックで外部辞書サイトを新規タブで開く | pending | - | - | - |

### Phase Details

**Phase 1: 単語クリックUIの実装**
- **Goal**: 英文中の各単語をクリックすると外部辞書サイトが開く
- **Scope**: `SentenceCard.tsx`の英文表示を単語ごとの`<span>`に分割し、クリックイベントで`window.open()`により外部辞書サイトを新規タブで開く
- **Success signal**: 実際の学習カードで単語をクリックすると、該当単語の辞書ページが新しいタブで開く

### Parallelism Notes

単一Phaseで完結する小規模機能のため、並列化の余地はない。Issue #10(進捗表示)・Issue #13(シャドーイング支援、協議中)とは独立した機能のため、worktreeで並行実装可能。

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| 辞書機能の実装方式 | 外部辞書サイトへのリンク遷移 | アプリ内でAPI呼び出し+ポップアップ表示(当初案) | 実装コスト・メンテナンス対象を大幅に削減するため(2026-09-13決定) |
| 辞書データソース(当初案、廃案) | ~~Free Dictionary API(dictionaryapi.dev)~~ | ~~Oxford Dictionaries API公式~~ | 方針変更によりどちらも不採用。参考: Oxford公式は月額£50〜で個人開発には高すぎるという調査結果は記録として残す |

---

## Research Summary

**Market Context**

個人利用が主目的のツールのため、今回も競合調査は実施していない(優先度低と判断)。

**Technical Context**

- `SentenceCard.tsx`は現状英文を単一の`<p>`要素で描画しており、単語単位のクリックには分割変更が必要
- 外部辞書サイトへの遷移は`window.open()`のみで実現可能で、サーバー側・API連携は一切不要

---

*Generated: 2026-08-31*
*Updated: 2026-09-13(外部リンク方式への変更)*
*Status: ACTIVE*
