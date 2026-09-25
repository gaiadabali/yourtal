import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";

// `.lab.tsx` files are routes only when built with YOURTAL_LAB=1 (next.config.ts),
// so none of this ships in a production build.
export const metadata: Metadata = { ...baseMetadata, robots: { index: false, follow: false } };
export const viewport = baseViewport;

export default function LabLayout({ children }: { children: ReactNode }) {
  return <RootDocument lang="en-AU">{children}</RootDocument>;
}
