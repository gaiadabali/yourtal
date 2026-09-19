import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

// YT-0400: one variable font (weight axis 200–800 in a single file),
// subset to Latin. Indonesian is written with the plain 26-letter Latin
// alphabet — no diacritics, no extended punctuation — so the standard
// `latin` subset (Basic Latin + the small set of common Latin-1
// punctuation/currency glyphs Google ships with it, verified against the
// "Rp" price strings and "×"/"–" characters used in copy) fully covers
// it. `latin-ext` adds accented forms (e.g. Ā, Ł, ő) for languages like
// Vietnamese or Polish, which this product does not target, so it is
// deliberately left out to keep the download small.
const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans-app",
});

export const metadata: Metadata = {
  title: "YourTal",
  description: "Watch, learn, earn — and spend it where you live.",
};

// Safe-area insets for notched devices (YT-0402).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="id-ID" suppressHydrationWarning className={fontSans.variable}>
      <body>{children}</body>
    </html>
  );
}
