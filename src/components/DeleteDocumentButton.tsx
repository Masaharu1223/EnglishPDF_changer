"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DeleteDocumentButtonProps {
  id: number;
}

export default function DeleteDocumentButton({ id }: DeleteDocumentButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

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
    } catch {
      // fall through to re-enable the button below
    }
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
