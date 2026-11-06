// 試験導入の機能(音声・文字起こし)を使えるユーザーを、環境変数の許可リストで判定する。
// 許可リストは FEATURE_ALLOWED_EMAILS(カンマ区切り)で、未設定のときは誰も許可しない。

// 引数: カンマ区切りのメールアドレス文字列(未設定可) / 返り値: 小文字にそろえたメールアドレスの Set
export function parseAllowedEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0)
  );
}

interface AccessUser {
  email?: string | null;
  emailVerified?: boolean | null;
}

// 引数: ユーザー情報、許可リスト文字列(省略時は環境変数) / 返り値: 機能を使ってよいかの真偽値
export function isFeatureAllowed(
  user: AccessUser | null | undefined,
  rawAllowedEmails: string | undefined = process.env.FEATURE_ALLOWED_EMAILS
): boolean {
  if (!user?.email || user.emailVerified !== true) return false;
  return parseAllowedEmails(rawAllowedEmails).has(user.email.toLowerCase());
}
