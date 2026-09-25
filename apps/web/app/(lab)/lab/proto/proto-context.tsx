"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { START_BALANCE, type Theme, type Variant } from "./lab-data";

export type Screen = "home" | "watch" | "store" | "wallet" | "me";

export interface Burst {
  id: number;
  points: number;
  from: { x: number; y: number };
}

interface ProtoState {
  variant: Variant;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  screen: Screen;
  go: (screen: Screen) => void;
  /** Available points only; pending points never count until they unlock. */
  available: number;
  pending: number;
  bursts: Burst[];
  /** Fires the earn moment: coins fly from `origin` to the pending badge. */
  earn: (points: number, origin?: Element | null) => void;
  spend: (points: number) => void;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  reducedMotion: boolean;
  /** Where the coins land: the pending badge beside the balance chip. */
  badgeRef: RefObject<HTMLSpanElement | null>;
}

const ProtoContext = createContext<ProtoState | null>(null);

export function useProto(): ProtoState {
  const state = useContext(ProtoContext);
  if (!state) throw new Error("useProto outside <ProtoProvider>");
  return state;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function ProtoProvider({
  variant,
  initialTheme,
  children,
}: {
  variant: Variant;
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [screen, setScreen] = useState<Screen>("home");
  const [available, setAvailable] = useState(START_BALANCE);
  const [pending, setPending] = useState(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [muted, setMuted] = useState(true);
  const reducedMotion = usePrefersReducedMotion();
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  const nextId = useRef(1);

  const earn = useCallback((points: number, origin?: Element | null) => {
    const box = origin?.getBoundingClientRect();
    const from = box
      ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const id = nextId.current++;
    setBursts((all) => [...all, { id, points, from }]);
    // The badge updates as the coins land, not before.
    window.setTimeout(() => setPending((p) => p + points), 750);
    window.setTimeout(() => setBursts((all) => all.filter((b) => b.id !== id)), 1100);
  }, []);

  const spend = useCallback((points: number) => setAvailable((a) => a - points), []);
  const go = useCallback((next: Screen) => {
    setScreen(next);
    window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo<ProtoState>(
    () => ({
      variant,
      theme,
      setTheme,
      screen,
      go,
      available,
      pending,
      bursts,
      earn,
      spend,
      muted,
      setMuted,
      reducedMotion,
      badgeRef,
    }),
    [variant, theme, screen, go, available, pending, bursts, earn, spend, muted, reducedMotion],
  );
  return <ProtoContext.Provider value={value}>{children}</ProtoContext.Provider>;
}
