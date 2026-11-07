// 全ページ共通のレイアウト。フォントとヘッダー、使用量の状態(UsageProvider)を全ページに提供する。

import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Header from "@/components/Header";
import { UsageProvider } from "@/components/UsageProvider";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "PDF/TXT Sentence Extractor",
  description: "Extract English sentences from PDF/TXT files with Japanese translation and audio",
};

// 引数: children(各ページの内容) / 返り値: html/body で包んだ全ページ共通の画面(JSX)
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <UsageProvider>
          <Header />
          {children}
        </UsageProvider>
      </body>
    </html>
  );
}
