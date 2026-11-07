"use client";
// Better Auth のクライアント側の認証クライアントを作り、サインイン・サインアウト・セッション取得を公開する。
// 同一オリジンの /api/auth へ相対パスでリクエストする。

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
