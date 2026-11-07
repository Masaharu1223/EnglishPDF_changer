// 利用制限の上限値(1日あたり・文字数)を、環境変数と既定値から決めて返す。
// 環境変数が未設定や不正な値のときは、既定値を使う。

export interface UsageLimits {
  anonIpChars: number;
  anonTotalChars: number;
  userChars: number;
  othersTotalChars: number;
  ownerChars: number;
  maxTranslateChunkChars: number;
  lockTimeoutMs: number;
  minChargeChars: number;
}

const INT32_MAX = 2_147_483_647;

// 引数: 環境変数名、既定値 / 返り値: 環境変数の正の整数(未設定・不正なら既定値)
function readLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= INT32_MAX ? n : fallback;
}

// 引数: なし / 返り値: 現在の利用制限の上限値一式
export function getUsageLimits(): UsageLimits {
  return {
    anonIpChars: readLimit("USAGE_LIMIT_ANON_IP_CHARS", 12_000),
    anonTotalChars: readLimit("USAGE_LIMIT_ANON_TOTAL_CHARS", 48_000),
    userChars: readLimit("USAGE_LIMIT_USER_CHARS", 30_000),
    othersTotalChars: readLimit("USAGE_LIMIT_OTHERS_TOTAL_CHARS", 100_000),
    ownerChars: readLimit("USAGE_LIMIT_OWNER_CHARS", 100_000),
    maxTranslateChunkChars: readLimit("MAX_TRANSLATE_CHUNK_CHARS", 2_000),
    lockTimeoutMs: readLimit("USAGE_LOCK_TIMEOUT_MS", 5_000),
    minChargeChars: readLimit("USAGE_MIN_CHARGE_CHARS", 500),
  };
}
