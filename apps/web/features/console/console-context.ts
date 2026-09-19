import type { BusinessMembership } from "./console-data";
import { listMyBusinesses } from "./console-data";

/**
 * Resolves "which business is this page for" from the request's search
 * params. Deliberately NOT read in a shared `layout.tsx` — Next's App
 * Router does not pass `searchParams` to layouts at all, only to
 * `page.tsx` (and only a Client Component can read them anywhere else, via
 * `useSearchParams`, which is not on the table for a Server Component
 * shell). Every zone `page.tsx` under `app/(app)/business/**` calls this
 * once and wraps its content in `ConsoleShell` itself, rather than relying
 * on a `business/layout.tsx` this constraint would make useless for the
 * one thing this console actually needs from a layout.
 */
export interface ConsoleContext {
  /** `undefined` when the signed-in person holds no role at any business at all. */
  current: BusinessMembership | undefined;
  all: BusinessMembership[];
  defaultBusinessId: string;
}

const EMPTY_CONTEXT_DEFAULT_ID = "";

/**
 * `searchParams` is typed loosely (Next's own `PageProps<Route>["searchParams"]`
 * shape, awaited by the caller) rather than importing that generated type
 * here, so this module has no dependency on which route called it.
 */
export async function resolveConsoleContext(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<ConsoleContext> {
  const all = await listMyBusinesses();
  const first = all[0];
  if (!first) {
    return { current: undefined, all, defaultBusinessId: EMPTY_CONTEXT_DEFAULT_ID };
  }
  const defaultBusinessId = first.business.id;
  const requestedId = typeof searchParams.business === "string" ? searchParams.business : undefined;
  const requested = requestedId
    ? all.find((membership) => membership.business.id === requestedId)
    : undefined;
  return { current: requested ?? first, all, defaultBusinessId };
}
