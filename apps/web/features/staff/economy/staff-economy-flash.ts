/** Reads which `?flag=1` (if any) a redirect from `staff-economy-actions.ts` landed on. */
export function flashFrom(
  searchParams: Record<string, string | string[] | undefined>,
  flags: readonly string[],
): string | undefined {
  return flags.find((flag) => searchParams[flag] !== undefined);
}
