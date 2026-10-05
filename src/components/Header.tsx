import Link from "next/link";
import AuthButton from "./AuthButton";

export default function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-end gap-4">
        <Link href="/history" className="text-sm text-gray-600 hover:text-gray-900">
          履歴
        </Link>
        <AuthButton />
      </div>
    </header>
  );
}
