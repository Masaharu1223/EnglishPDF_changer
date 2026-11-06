// 認証API。Better Auth のリクエストを受け付けるハンドラーを公開する。

import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { POST, GET } = toNextJsHandler(auth);
