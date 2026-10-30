// 試験導入の機能(音声・文字起こし)を使えるユーザーを、環境変数の許可リストで判定する。
// 公開するときは、この判定の条件を変えるだけで済む(ブランチ操作は不要)。
//
// FEATURE_ALLOWED_EMAILS: 許可するメールアドレスをカンマ区切りで並べる。
// 未設定・空のときは、誰にも許可しない(安全側)。

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

// メールアドレスが未確認のアカウントは許可しない(他人のアドレスで登録される恐れに備える)。
// Googleログインのメールアドレスは確認済みとして返る。
export function isFeatureAllowed(
  user: AccessUser | null | undefined,
  rawAllowedEmails: string | undefined = process.env.FEATURE_ALLOWED_EMAILS
): boolean {
  if (!user?.email || user.emailVerified !== true) return false;
  return parseAllowedEmails(rawAllowedEmails).has(user.email.toLowerCase());
}
