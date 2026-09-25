"use client";

import { Flame } from "lucide-react";
import { useLayoutEffect, useState, type CSSProperties } from "react";
import { UNLOCKS_ON, type Channel } from "./lab-data";
import { useProto, type Burst } from "./proto-context";

const pts = new Intl.NumberFormat("en-AU");

/** The coin glyph: the mark on every points amount. */
export function Coin({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7.25" fill="var(--lab-points-strong)" stroke="#8a5a00" />
      <path d="M5.2 4.6 8 8.2l2.8-3.6M8 8.2v3.4" stroke="#5c3b00" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

/** One chip for every points amount: gold fill, dark text, tabular numerals. */
export function PointsChip({
  value,
  prefix = "",
  size = "md",
  label,
}: {
  value: number;
  prefix?: string;
  size?: "sm" | "md";
  label?: string;
}) {
  const sizing = size === "sm" ? "h-6 gap-1 px-2 text-xs" : "h-8 gap-1.5 px-3 text-sm";
  return (
    <span
      aria-label={label ?? `${prefix}${pts.format(value)} points`}
      className={`inline-flex w-fit shrink-0 items-center rounded-full bg-(--lab-points) font-bold text-(--lab-fg-on-points) tabular-nums ${sizing}`}
    >
      <Coin size={size === "sm" ? 12 : 16} />
      {prefix}
      {pts.format(value)}
    </span>
  );
}

/** "+N pending · unlocks <date>" beside the balance chip; it is where coins land. */
export function PendingBadge({ onVideo = false }: { onVideo?: boolean }) {
  const { pending, badgeRef } = useProto();
  const tone = onVideo
    ? "bg-black/60 text-white"
    : "bg-(--lab-surface-2) text-(--lab-fg) border border-(--lab-border)";
  return (
    <span
      ref={badgeRef}
      role="status"
      className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap tabular-nums ${pending ? `lab-pop ${tone}` : "w-0 overflow-hidden px-0"}`}
      key={pending}
    >
      {pending ? `+${pts.format(pending)} pending · unlocks ${UNLOCKS_ON}` : null}
    </span>
  );
}

export function StreakFlame({ days, onVideo = false }: { days: number; onVideo?: boolean }) {
  return (
    <span
      aria-label={`${days}-day streak`}
      className={`inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-sm font-bold tabular-nums ${onVideo ? "bg-black/60 text-white" : "bg-(--lab-surface-2) text-(--lab-fg)"}`}
    >
      <Flame size={16} aria-hidden="true" className="fill-(--lab-streak) text-(--lab-streak)" />
      {days}
    </span>
  );
}

export function ChannelAvatar({ channel, size = 40 }: { channel: Channel; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, backgroundColor: channel.hue, fontSize: size * 0.36 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-(family-name:--lab-display) font-extrabold text-white ring-2 ring-white/80"
    >
      {channel.initials}
    </span>
  );
}

function Coins({ burst }: { burst: Burst }) {
  const { badgeRef } = useProto();
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const box = badgeRef.current?.getBoundingClientRect();
    setTarget(box ? { x: box.left + 12, y: box.top + box.height / 2 } : { x: 60, y: 30 });
  }, [badgeRef]);
  if (!target) return null;
  const count = Math.min(10, 4 + burst.points);
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const style = {
          left: burst.from.x - 10,
          top: burst.from.y - 10,
          animationDelay: `${i * 30}ms`,
          "--burst-x": `${Math.cos(angle) * 56}px`,
          "--burst-y": `${Math.sin(angle) * 56}px`,
          "--to-x": `${target.x - burst.from.x}px`,
          "--to-y": `${target.y - burst.from.y}px`,
        } as CSSProperties;
        return (
          <span key={i} className="lab-coin fixed z-50 opacity-0" style={style}>
            <Coin size={20} />
          </span>
        );
      })}
      <span
        className="lab-pop fixed z-50 -translate-x-1/2 -translate-y-1/2"
        style={{ left: burst.from.x, top: burst.from.y - 48 }}
      >
        <PointsChip value={burst.points} prefix="+" />
      </span>
    </>
  );
}

/** Renders every in-flight burst above the app. Hidden under reduced motion. */
export function EarnLayer() {
  const { bursts } = useProto();
  return (
    <div aria-hidden="true" className="pointer-events-none">
      {bursts.map((burst) => (
        <Coins key={burst.id} burst={burst} />
      ))}
    </div>
  );
}
