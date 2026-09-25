import { ViewerShell } from "@/features/shell/viewer-shell";

/**
 * The real viewer shell at full viewport size, with no session. Every (app)
 * route needs one since 1.7.c, so the rendered gate checks the shell's
 * breakpoints and links here.
 */
export default function LabShellPage() {
  return (
    <ViewerShell locale="en-AU" availablePoints={1240}>
      <div className="flex flex-col gap-3 p-4">
        <h1 className="font-display text-headline text-fg">Shell</h1>
        <p className="text-body text-fg-muted">Screen content renders here.</p>
      </div>
    </ViewerShell>
  );
}
