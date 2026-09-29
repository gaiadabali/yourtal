// Small stroke icons for the feed's right rail. Decorative: the button carries the name.
const COMMON = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function ShareIcon() {
  return (
    <svg {...COMMON}>
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" />
    </svg>
  );
}

export function SaveIcon({ filled }: { filled: boolean }) {
  return (
    <svg {...COMMON} fill={filled ? "currentColor" : "none"}>
      <path d="M6 3h12v18l-6-4-6 4z" />
    </svg>
  );
}

export function HideIcon() {
  return (
    <svg {...COMMON}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg {...COMMON}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </svg>
  );
}
