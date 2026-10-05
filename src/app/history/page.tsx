import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { listDocuments } from "@/lib/documents";
import { formatDateTimeJST } from "@/lib/format";

export default async function HistoryPage() {
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

  const documents = await listDocuments(session.user.id);

  return (
    <main className="min-h-screen py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">履歴</h1>
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            トップページに戻る
          </Link>
        </div>

        {documents.length === 0 ? (
          <p className="text-center text-gray-400 py-8">まだ保存された教材はありません</p>
        ) : (
          <ul className="space-y-3">
            {documents.map((doc) => (
              <li key={doc.id}>
                <Link
                  href={`/history/${doc.id}`}
                  className="block bg-white rounded-lg border border-gray-200 p-5 shadow-sm hover:border-blue-300 transition-colors"
                >
                  <p className="text-gray-900 font-medium truncate">{doc.title}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {doc.sentenceCount}文 · {formatDateTimeJST(doc.createdAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
