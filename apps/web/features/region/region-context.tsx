"use client";

import { createContext, type ReactNode } from "react";
import type { Region } from "@yourtal/contracts/region";

/**
 * Ambient region storage (YT-0405). `Region` is imported type-only —
 * `verbatimModuleSyntax` erases it, so this file never pulls in
 * `@yourtal/contracts/region`'s Zod schema (docs/13b-typescript-standards.md
 * §8's initial-JS budget: a value-import from any `@yourtal/contracts/*`
 * entity module risks dragging in ~96 KB of Zod, which is exactly what
 * `money-format.ts` was split out to avoid — see that file's docstring).
 *
 * `null` means "not inside a `RegionProvider`" — `use-region.ts` throws on
 * it rather than silently defaulting, because a screen that renders with the
 * wrong region is a worse failure than a screen that crashes in dev.
 */
export const RegionContext = createContext<Region | null>(null);

export interface RegionProviderProps {
  region: Region;
  children: ReactNode;
}

/**
 * Makes the active region available to any descendant Client Component
 * without prop-drilling (docs/13b-typescript-standards.md §8: React Context
 * is correct for ambient, rarely-changing values like locale and region —
 * this is exactly that case — and is explicitly NOT a cache for server
 * data, which is exactly why this holds only the two-letter `Region` code
 * and nothing fetched).
 *
 * This is the one "use client" boundary; `children` is passed straight
 * through as a prop, so Server Component descendants below it are
 * unaffected and stay server-rendered (the standard RSC composition
 * pattern — a Client Component can hold Server Component children, it just
 * cannot import or render them itself).
 *
 * Server Components can't call `useRegion()` (it needs `"use client"`); they
 * resolve the region directly via `get-region.ts` instead, the same way
 * Next's own `cookies()`/`headers()` are ambient without being passed as
 * props.
 */
export function RegionProvider({ region, children }: RegionProviderProps) {
  return <RegionContext.Provider value={region}>{children}</RegionContext.Provider>;
}
