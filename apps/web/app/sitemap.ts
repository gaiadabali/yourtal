import type { MetadataRoute } from "next";
import { publicSitemapEntries } from "@/features/public/public-sitemap-entries";

/**
 * `/sitemap.xml` (YT-0180). Next's file convention requires this at the
 * root of `app/`, not inside `app/(public)/**` — a route group changes
 * nothing about the URL, but the sitemap file itself is only recognised at
 * the app root (`node_modules/next/dist/docs/.../metadata/sitemap.md`).
 *
 * All the real work — which URLs exist, which locales, which alternates —
 * lives in `public-sitemap-entries.ts`, generated from the same catalogue
 * every public route's own `generateStaticParams` reads. This file is
 * intentionally just the wiring Next's convention requires.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return publicSitemapEntries();
}
