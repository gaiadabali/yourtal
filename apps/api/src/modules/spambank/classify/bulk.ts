import { type HeaderInput, hasNonBlankValue, headerValues, simpleValue } from "./header-values";

export interface BulkHeaders {
  readonly listUnsubscribe?: HeaderInput;
  readonly listId?: HeaderInput;
  readonly precedence?: HeaderInput;
}

function precedenceIn(h: BulkHeaders, accepted: readonly string[]): boolean {
  return headerValues(h.precedence).some((v) => {
    const p = simpleValue(v);
    return p !== null && accepted.includes(p);
  });
}

export function hasListUnsubscribe(h: BulkHeaders): boolean {
  return hasNonBlankValue(h.listUnsubscribe);
}

/**
 * BUILD.md §4.6 check 3 (`not_bulk` when false): `List-Unsubscribe` or
 * `List-Id` present, or `Precedence` is `bulk` or `list`.
 */
export function hasBulkMarkers(h: BulkHeaders): boolean {
  return hasListUnsubscribe(h) || hasNonBlankValue(h.listId) || precedenceIn(h, ["bulk", "list"]);
}

/**
 * The Junk-folder rule of the §4.2 Sieve script (`Precedence` also `junk`),
 * for `ingested_message.bulk` and the move-after-delivery fallback (U3).
 */
export function isBulkForFiling(h: BulkHeaders): boolean {
  return (
    hasListUnsubscribe(h) || hasNonBlankValue(h.listId) || precedenceIn(h, ["bulk", "list", "junk"])
  );
}
