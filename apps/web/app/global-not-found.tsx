import type { Metadata } from "next";
import { RootDocument, baseViewport } from "@/app/root-document";
import { PublicFooter } from "@/features/public/public-footer";
import { PublicInfoLinks } from "@/features/public/public-info-links";
import { PublicHeader } from "@/features/public/public-header";
import { PublicNotFound } from "@/features/public/public-not-found";
import { getPublicTranslator } from "@/features/public/public-i18n";

// Unmatched URLs skip every layout (there are several root layouts), so this carries its own shell.
export const metadata: Metadata = {
  title: getPublicTranslator("en-AU")("notFound.heading"),
  robots: { index: false },
};

export const viewport = baseViewport;

export default function GlobalNotFound() {
  return (
    <RootDocument lang="en-AU">
      <div className="flex min-h-dvh flex-col bg-surface">
        <PublicHeader locale="en-AU" homeHref="/au" />
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
          <PublicNotFound />
        </main>
        <PublicFooter locale="en-AU">
          <PublicInfoLinks locale="en-AU" basePath="/au" />
        </PublicFooter>
      </div>
    </RootDocument>
  );
}
