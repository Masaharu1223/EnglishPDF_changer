"use client";

import { createAuthClient } from "better-auth/react";

// baseURLは省略(同一オリジンの /api/auth へ相対パスでリクエストされる)
export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
