// 利用制限の上限値(1日あたり・文字数)。環境変数で上書きでき、未設定や不正な値のときは
// 下の既定値を使う(設定を忘れても安全な値で動く)。環境変数はサーバー専用で、
// NEXT_PUBLIC_ は付けない。変更は Vercel で保存したあと Redeploy しないと反映されない。
//
// 既定値は「自分以外のユーザー全員の利用総額を月5,000円に収める」前提で決めている
// (1,000文字あたり約1.1円=概算の高いほうで計算し、31日分で 14万文字/日)。
// 実際の単価は、翻訳APIのレスポンスの usage を見て見直す。

export interface UsageLimits {
  // 未ログイン: 同じIPが1日に使える上限
  anonIpChars: number;
  // 未ログイン: 全員の合計の上限(個人の回避が可能でも、費用の天井になる)
  anonTotalChars: number;
  // ログイン済み(自分以外): 1ユーザーが1日に使える上限
  userChars: number;
  // 自分以外のユーザー全員(未ログイン+ログイン済み)の合計の上限
  othersTotalChars: number;
  // 自分(許可リストのアカウント): 誤操作や暴走に備えた安全装置
  ownerChars: number;
  // 翻訳1リクエストで受け付ける chunk の最大文字数(通常の分割は1,500文字)
  maxTranslateChunkChars: number;
  // 他のリクエストが持つ行のロックを待つ最大時間(ミリ秒)。詰まったとき、いつまでも
  // 待たせず、数秒で諦めて断る(使い放題にならない側に倒す)
  lockTimeoutMs: number;
  // 翻訳1リクエストの最低課金(文字数換算)。chunk が短くても、Claude の呼び出しには
  // プロンプトとツール定義の入力トークンが毎回かかる。文字数だけで数えると、短い
  // chunk を大量に送られて費用が膨らむので、短くてもこの文字数分は予約する
  minChargeChars: number;
}

const INT32_MAX = 2_147_483_647;

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  // DB の int(32bit)に入らない値だと、予約のSQLが全リクエストで失敗してしまう
  return Number.isInteger(n) && n > 0 && n <= INT32_MAX ? n : fallback;
}

export function getUsageLimits(): UsageLimits {
  return {
    anonIpChars: readLimit("USAGE_LIMIT_ANON_IP_CHARS", 12_000),
    anonTotalChars: readLimit("USAGE_LIMIT_ANON_TOTAL_CHARS", 48_000),
    userChars: readLimit("USAGE_LIMIT_USER_CHARS", 30_000),
    othersTotalChars: readLimit("USAGE_LIMIT_OTHERS_TOTAL_CHARS", 140_000),
    ownerChars: readLimit("USAGE_LIMIT_OWNER_CHARS", 100_000),
    maxTranslateChunkChars: readLimit("MAX_TRANSLATE_CHUNK_CHARS", 2_000),
    lockTimeoutMs: readLimit("USAGE_LOCK_TIMEOUT_MS", 5_000),
    minChargeChars: readLimit("USAGE_MIN_CHARGE_CHARS", 500),
  };
}
