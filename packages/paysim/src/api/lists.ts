import type { Ctx } from "../ctx";
import { invalidRequest, resourceMissing } from "../errors";
import type { ParamObject } from "../form";
import { int, str } from "../params";
import { label } from "../domain/repo";
import type { JsonObject, StoredObject } from "../store";
import type { Out } from "./common";

/** Stripe's list envelope: `limit`, `starting_after`, newest first, `has_more`. */

function limitOf(params: ParamObject): number {
  const limit = int(params, "limit") ?? 10;
  if (limit < 1 || limit > 100) {
    throw invalidRequest("Invalid limit: must be between 1 and 100.", { param: "limit" });
  }
  return limit;
}

const createdOf = (o: StoredObject): number =>
  typeof o.data["created"] === "number" ? o.data["created"] : 0;

/** `created[gte|gt|lte|lt]`, as Stripe's list filters. */
export function createdFilter(params: ParamObject): (o: StoredObject) => boolean {
  const gte = int(params, "created", "gte");
  const gt = int(params, "created", "gt");
  const lte = int(params, "created", "lte");
  const lt = int(params, "created", "lt");
  return (o) => {
    const at = createdOf(o);
    return (
      (gte === undefined || at >= gte) &&
      (gt === undefined || at > gt) &&
      (lte === undefined || at <= lte) &&
      (lt === undefined || at < lt)
    );
  };
}

/** `oldestFirst` is insertion order; the cursor applies to the whole list, then `keep` narrows it. */
export function listPage(
  ctx: Ctx,
  params: ParamObject,
  type: string,
  url: string,
  oldestFirst: readonly StoredObject[],
  keep: (o: StoredObject) => boolean,
): Out {
  const limit = limitOf(params);
  // Reversed first, so objects created in the same second list later-inserted first (the sort is stable).
  let newest = [...oldestFirst].reverse().sort((a, b) => createdOf(b) - createdOf(a));
  const after = str(params, "starting_after");
  if (after !== undefined) {
    const at = newest.findIndex((o) => o.id === after);
    if (at < 0) throw resourceMissing(label(type), after, "starting_after");
    newest = newest.slice(at + 1);
  }
  const matching = newest.filter(keep);
  const data: JsonObject[] = matching.slice(0, limit).map((o) => o.data);
  return {
    body: { object: "list", url, has_more: matching.length > limit, data },
  };
}
