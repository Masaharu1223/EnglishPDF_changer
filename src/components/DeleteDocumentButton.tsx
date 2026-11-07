"use client";
// 教材(ドキュメント)を削除するボタン。
// 確認ダイアログのあとAPIで削除し、履歴一覧へ戻る。

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DeleteDocumentButtonProps {
  id: number;
}

// 引数: props(id: 削除する教材のID) / 返り値: 削除ボタンのJSX
export default function DeleteDocumentButton({ id }: DeleteDocumentButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  // 引数: なし / 返り値: なし(確認後に教材を削除し、履歴一覧へ遷移する)
  const handleDelete = async () => {
    if (!confirm("この教材を削除しますか?")) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/history");
        router.refresh();
        return;
      }
    } catch {}
    setIsDeleting(false);
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isDeleting}
      className="text-sm text-red-500 hover:text-red-700 underline disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isDeleting ? "削除中..." : "削除"}
    </button>
  );
}
