import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getDocumentWithSentences } from "@/lib/documents";
import { formatDateTimeJST } from "@/lib/format";
import DeleteDocumentButton from "@/components/DeleteDocumentButton";
import SentenceResultView from "@/components/SentenceResultView";

export default async function HistoryDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const documentId = Number(params.id);
  if (!Number.isInteger(documentId)) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <main className="min-h-screen py-12 px-4">
        <div className="max-w-3xl mx-auto text-center text-gray-500">
          <p>履歴を見るにはログインしてください。</p>
          <Link href="/" className="text-blue-600 hover:underline mt-2 inline-block">
            トップページに戻る
          </Link>
        </div>
      </main>
    );
  }

  const doc = await getDocumentWithSentences(session.user.id, documentId);
  if (!doc) notFound();

  const sentences = doc.sentences.map((s) => ({
    id: String(s.id),
    original: s.original,
    translation: s.translation,
  }));

  return (
    <main className="min-h-screen py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        <Link href="/history" className="text-sm text-blue-600 hover:underline">
          ← 履歴一覧
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{doc.title}</h1>
            <p className="text-sm text-gray-500 mt-1">{formatDateTimeJST(doc.createdAt)}</p>
          </div>
          <DeleteDocumentButton id={doc.id} />
        </div>

        <SentenceResultView sentences={sentences} />
      </div>
    </main>
  );
}
