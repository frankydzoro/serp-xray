import type { Metadata } from "next";
import { Suspense } from "react";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import AppNav from "@/components/AppNav";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "SERP X-Ray — competitive SERP analysis",
  description:
    "Extract entities from search results, find content gaps, and get actionable recommendations via OpenRouter + SerpAPI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <style>{`
          :root {
            --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
            --font-mono: 'JetBrains Mono', ui-monospace, monospace;
            --font-heading: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
          }
        `}</style>
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AppNav />
        <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>}>
            {children}
          </Suspense>
        </main>
      </body>
    </html>
  );
}