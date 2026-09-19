import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

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
    <html lang="id-ID" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
