"use client";

import { House, Play, Store as StoreIcon, User, Wallet as WalletIcon } from "lucide-react";
import { useState } from "react";
import { Coin, EarnLayer, PendingBadge, PointsChip, StreakFlame } from "./bits";
import { Feed } from "./feed";
import { fontVariables } from "./fonts";
import { LONG_FORM, STREAK_DAYS, type Campaign, type Theme, type Variant } from "./lab-data";
import { Player } from "./player";
import { ProtoProvider, useProto, type Screen } from "./proto-context";
import { Me, Store, Wallet } from "./screens";
import "./lab.css";

const NAV: { screen: Screen; label: string; Icon: typeof House }[] = [
  { screen: "home", label: "Home", Icon: House },
  { screen: "watch", label: "Watch", Icon: Play },
  { screen: "store", label: "Store", Icon: StoreIcon },
  { screen: "wallet", label: "Wallet", Icon: WalletIcon },
  { screen: "me", label: "Me", Icon: User },
];

function TopBar({ overVideo }: { overVideo: boolean }) {
  const { available, pending } = useProto();
  return (
    <header
      className={
        overVideo
          ? "absolute inset-x-0 top-0 z-30 flex items-center gap-1.5 bg-(image:--lab-scrim-top) px-3 pt-3 pb-6 text-white"
          : "relative z-30 flex items-center gap-1.5 border-b border-(--lab-border) bg-(--lab-canvas) px-3 py-2.5"
      }
    >
      <span className="flex items-center gap-1 font-(family-name:--lab-display) text-xl font-extrabold">
        <Coin size={20} />
        {/* The wordmark steps aside while the pending badge needs the room. */}
        <span className={pending ? "sr-only" : ""}>YourTal</span>
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <PendingBadge onVideo={overVideo} />
        <PointsChip
          value={available}
          label={`${available.toLocaleString("en-AU")} points available`}
        />
        <StreakFlame days={STREAK_DAYS} onVideo={overVideo} />
      </span>
    </header>
  );
}

function BottomNav() {
  const { screen, go, variant } = useProto();
  const dark = variant === "after-dark" && screen === "home";
  return (
    <nav
      aria-label="Primary"
      className={`grid grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] ${dark ? "border-white/10 bg-black text-white" : "border-(--lab-border) bg-(--lab-canvas)"}`}
    >
      {NAV.map(({ screen: target, label, Icon }) => {
        const current = screen === target;
        return (
          <button
            key={target}
            type="button"
            aria-current={current ? "page" : undefined}
            onClick={() => go(target)}
            className={`flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${current ? (dark ? "text-white" : "text-(--lab-accent-text)") : dark ? "text-white/80" : "text-(--lab-fg-muted)"}`}
          >
            <Icon size={22} aria-hidden="true" strokeWidth={current ? 2.5 : 2} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function Shell() {
  const { screen, go, variant, theme } = useProto();
  const [campaign, setCampaign] = useState<Campaign>(LONG_FORM);
  const overVideo = variant === "after-dark" && screen === "home";
  const open = (next: Campaign) => {
    setCampaign(next);
    go("watch");
  };
  return (
    <div
      data-variant={variant}
      data-theme={theme}
      className={`${fontVariables} min-h-dvh bg-(--lab-canvas) text-(--lab-fg)`}
    >
      <div className="relative mx-auto flex h-dvh max-w-[480px] flex-col overflow-hidden lg:border-x lg:border-(--lab-border)">
        <TopBar overVideo={overVideo} />
        <main
          // A scrolling screen must be reachable by keyboard; the feed scrolls itself.
          tabIndex={screen === "home" ? undefined : 0}
          className={`min-h-0 flex-1 ${screen === "home" ? "" : "overflow-y-auto"}`}
        >
          {screen === "home" ? <Feed onOpen={open} /> : null}
          {screen === "watch" ? (
            <Player key={campaign.clip} campaign={campaign} onBack={() => go("home")} />
          ) : null}
          {screen === "store" ? <Store /> : null}
          {screen === "wallet" ? <Wallet /> : null}
          {screen === "me" ? <Me /> : null}
        </main>
        <BottomNav />
      </div>
      <EarnLayer />
    </div>
  );
}

export function Prototype({ variant, theme }: { variant: Variant; theme: Theme }) {
  return (
    <ProtoProvider variant={variant} initialTheme={theme}>
      <Shell />
    </ProtoProvider>
  );
}
