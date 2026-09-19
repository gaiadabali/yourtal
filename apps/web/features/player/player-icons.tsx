/**
 * Small inline icons, hand-rolled rather than pulled from a package apps/web
 * does not itself declare a dependency on (lucide-react is only declared by
 * `@yourtal/ui`, layer 1 — see docs/13-engineering-standards.md §2). Purely
 * decorative; the accessible name always comes from the surrounding
 * button's `aria-label`, never from these.
 */
export interface PlayerIconProps {
  className?: string;
}

export function PlayIcon({ className }: PlayerIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.87l11-6.86a1 1 0 0 0 0-1.74l-11-6.86A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

export function PauseIcon({ className }: PlayerIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M7 5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H7Zm8 0a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2Z" />
    </svg>
  );
}
