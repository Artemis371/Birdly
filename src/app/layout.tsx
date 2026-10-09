import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { site } from "@/config/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: `${site.name} · ${site.tagline}`, template: `%s · ${site.name}` },
  description: site.description,
  icons: { icon: { url: "/brand/icon.svg", type: "image/svg+xml" } },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: site.colors.bg, width: "device-width", initialScale: 1 };

// Brand colors from the config file, exposed as CSS variables.
const c = site.colors;
const themeVars = `:root{--accent:${c.accent};--accent-strong:${c.accentStrong};--yes:${c.yes};--no:${c.no};--bg:${c.bg};--surface:${c.surface};--surface-2:${c.surface2};--border:${c.border};--text:${c.text};--muted:${c.muted};--warn:${c.warn}}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeVars }} />
      </head>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
          <Nav />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-4">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 pb-24 pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between md:pb-6">
            <span>
              {site.name} · Paper money only. Nothing here is real money or financial advice.
            </span>
            <span>{site.dataCredit}</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
