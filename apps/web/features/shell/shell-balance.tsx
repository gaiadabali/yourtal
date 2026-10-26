"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface ShellBalance {
  points: number;
  adopt: (points: number) => void;
}

const ShellBalanceContext = createContext<ShellBalance | null>(null);

/**
 * The points chip in the top bar is read once, when the layout renders, and a
 * client navigation does not render the layout again. So after something moves
 * the balance (a redemption), the flow hands the new figure here and the chip
 * shows it at once. The figure counts only while the server's own value is the
 * one it was measured against: the next real read of the balance wins.
 */
export function ShellBalanceProvider({
  serverPoints,
  children,
}: {
  serverPoints: number;
  children: ReactNode;
}) {
  const [adopted, setAdopted] = useState<{ base: number; points: number } | null>(null);
  const adopt = useCallback(
    (points: number) => setAdopted({ base: serverPoints, points }),
    [serverPoints],
  );
  const points = adopted !== null && adopted.base === serverPoints ? adopted.points : serverPoints;
  const value = useMemo(() => ({ points, adopt }), [points, adopt]);
  return <ShellBalanceContext.Provider value={value}>{children}</ShellBalanceContext.Provider>;
}

/** The chip's figure: what a flow last adopted, else the server's. Outside a shell, the fallback. */
export function useShellBalance(fallback: number): number {
  return useContext(ShellBalanceContext)?.points ?? fallback;
}

/** For the flow that just spent or earned: show this balance in the header now. A no-op outside a shell. */
export function useAdoptShellBalance(): (points: number) => void {
  return useContext(ShellBalanceContext)?.adopt ?? noop;
}

function noop(): void {
  /* outside a shell there is no chip to update */
}
