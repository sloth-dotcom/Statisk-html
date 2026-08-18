import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Udbudsradar",
  description: "Internt værktøj: udbud fra udbud.dk scoret mod vores forretningsprofiler.",
  robots: { index: false, follow: false },
};

const nav = [
  { href: "/", label: "Radar" },
  { href: "/profiler", label: "Profiler" },
  { href: "/status", label: "Status" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body>
        <header className="border-b border-[var(--color-kant)] bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Udbudsradar
            </Link>
            <nav className="flex items-center gap-4 text-sm text-[var(--color-daempet)]">
              {nav.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-[var(--color-accent)]">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
