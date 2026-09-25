import type { MetadataRoute } from "next";

/**
 * `/manifest.webmanifest` (task 3.6.a). Root of `app/`, same file-convention
 * reasoning as `robots.ts` and `sitemap.ts` next to it — Next serves and
 * links this from every route regardless of which route group's root
 * layout renders the page.
 *
 * This does not turn on install prompts or offline navigation on its own —
 * `app/sw.ts` (Serwist) already owns caching, and its own header explains
 * why an install prompt is a separate, product-level decision this file
 * has no brief to make. A manifest with icons is also what silences
 * Lighthouse's "no manifest" PWA warning and gives Android something to
 * show if a user does add YourTal to their home screen.
 *
 * Colours match the "After Dark" canvas (`--color-canvas`'s dark value,
 * `packages/ui/src/styles/tokens.css`), not a Tailwind class: this file
 * runs at build/request time with no CSS engine attached, the same reason
 * `scripts/build-brand-icons.mjs` hard-codes the same hex.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YourTal",
    short_name: "YourTal",
    description: "Watch, learn, earn — and spend it where you live.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0B0F",
    theme_color: "#0B0B0F",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
