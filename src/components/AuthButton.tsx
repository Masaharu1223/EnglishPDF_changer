"use client";
// Googleログイン/ログアウトのボタンを表示するコンポーネント。
// ログイン済みならユーザー画像と名前も出す。

import { signIn, signOut, useSession } from "@/lib/auth-client";

// 引数: なし / 返り値: ログイン状態に応じたボタン(読み込み中はプレースホルダー)のJSX
export default function AuthButton() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return <div className="h-8 w-20 bg-gray-100 rounded animate-pulse" />;
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-3">
        {session.user.image && (
          // eslint-disable-next-line @next/next/no-img-element -- 外部ドメインの画像で next/image の設定を避けるため
          <img
            src={session.user.image}
            alt=""
            className="w-8 h-8 rounded-full"
          />
        )}
        <span className="text-sm text-gray-700 hidden sm:inline">
          {session.user.name}
        </span>
        <button
          onClick={() => signOut()}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          ログアウト
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn.social({ provider: "google" })}
      className="text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
    >
      Googleでログイン
    </button>
  );
}
