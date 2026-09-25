import * as React from "react";

export interface GallerySectionProps {
  /** Stable id for deep-linking and single-section screenshots. */
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * The one shape every gallery section takes: a labelled `<section>` with a
 * stable `id` and a `data-testid="gallery-<id>"`, so a visual test can
 * screenshot exactly one group of primitives at a time.
 */
export function GallerySection({ id, title, description, children }: GallerySectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      data-testid={`gallery-${id}`}
      aria-labelledby={headingId}
      className="flex flex-col gap-4 border-t border-border-subtle pt-8 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-title font-sans font-semibold text-fg">
          {title}
        </h2>
        {description ? <p className="text-body-sm text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A labelled row of demo instances within a section, e.g. every Button size. */
export function GalleryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption font-sans font-medium text-fg-subtle">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
