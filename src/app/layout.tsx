import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { AskProvider } from "@/components/AskPanel";
import { Nav } from "@/components/Nav";
import "./globals.css";

const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", style: ["normal", "italic"], axes: ["opsz"] });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb" });

export const metadata: Metadata = {
  title: "The Daily Desk",
  description: "A private newsroom of agents: news, explainers, history and manga.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return (
    <html lang="en" className={`${newsreader.variable} ${inter.variable} ${mono.variable}`}>
      <body className="font-sans min-h-screen">
        <AskProvider>
        <header className="mx-auto max-w-6xl px-4 sm:px-8 pt-8">
          <div className="flex items-end justify-between gap-4 border-b-2 border-ink pb-3">
            <a href="/" className="font-serif text-4xl sm:text-5xl tracking-tight leading-none">
              The Daily Desk
            </a>
            <div className="kicker hidden sm:block text-right">{today}</div>
          </div>
          <Nav />
        </header>
        {!process.env.OPENROUTER_API_KEY && (
          <div className="mx-auto max-w-6xl px-4 sm:px-8 mt-4">
            <div className="card px-4 py-3 text-sm border-accent/50 bg-accent-soft">
              <strong>Agents are paused:</strong> add <code className="font-mono">OPENROUTER_API_KEY</code> to <code className="font-mono">.env.local</code> and restart.
            </div>
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 sm:px-8 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 sm:px-8 pb-10 pt-6 border-t border-rule kicker">Written by agents · read by one</footer>
        </AskProvider>
      </body>
    </html>
  );
}
