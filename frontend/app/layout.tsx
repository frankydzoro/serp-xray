import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SERP X-Ray  competitive SERP analysis",
  description: "Local tool for entity analysis in search results via OpenRouter + SerpAPI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b border-border bg-card">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-6">
            <Link href="/" className="font-bold text-lg hover:text-primary">
               SERP X-Ray
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="hover:text-primary transition-colors">Analysis</Link>
              <Link href="/history" className="hover:text-primary transition-colors">History</Link>
              <Link href="/admin" className="hover:text-primary transition-colors">Admin</Link>
            </nav>
          </div>
        </header>
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">{children}</main>
      </body>
    </html>
  );
}