import AuthButton from "./AuthButton";

export default function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-end">
        <AuthButton />
      </div>
    </header>
  );
}
