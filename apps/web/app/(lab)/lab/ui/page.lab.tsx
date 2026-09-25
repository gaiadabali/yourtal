import type { GallerySurface, GalleryTheme } from "./gallery";
import { Gallery } from "./gallery";

export interface LabUiPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isSurface(value: string | undefined): value is GallerySurface {
  return value === "viewer" || value === "studio" || value === "counter";
}

function isTheme(value: string | undefined): value is GalleryTheme {
  return value === "light" || value === "dark";
}

/**
 * `/lab/ui` — the primitive gallery, live only in a `YOURTAL_LAB=1` build
 * (see next.config.ts). A server component so `?surface=`/`?theme=` can be
 * read once from the URL — visual tests load a specific combination
 * directly — before the header's SegmentedControl pickers take over.
 * Defaults match the product: `viewer`, dark-first.
 */
export default async function LabUiPage({ searchParams }: LabUiPageProps) {
  const params = await searchParams;
  const surface = firstValue(params.surface);
  const theme = firstValue(params.theme);

  return (
    <Gallery
      initialSurface={isSurface(surface) ? surface : "viewer"}
      initialTheme={isTheme(theme) ? theme : "dark"}
    />
  );
}
