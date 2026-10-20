import type { Ctx } from "../ctx";
import { invalidRequest } from "../errors";
import type { ParamObject } from "../form";
import { list } from "../params";
import type { JsonObject, StoredObject } from "../store";
import { load } from "../domain/repo";

export interface Out {
  status?: number;
  body: JsonObject;
}

export interface Req {
  params: ParamObject;
  /** The `:id` path parameter, when the route has one. */
  id: string;
}

export interface Route {
  method: "GET" | "POST" | "DELETE";
  path: string;
  run(ctx: Ctx, req: Req): Promise<Out>;
}

/** Fields `expand[]` may turn from an id into the object, per object type. */
const EXPANDABLE: Record<string, Record<string, string>> = {
  "checkout.session": {
    payment_intent: "payment_intent",
    setup_intent: "setup_intent",
    customer: "customer",
  },
  payment_intent: {
    latest_charge: "charge",
    customer: "customer",
    payment_method: "payment_method",
  },
  setup_intent: { payment_method: "payment_method", customer: "customer" },
};

function expandPaths(params: ParamObject): string[] {
  return (list(params, "expand") ?? []).filter((v): v is string => typeof v === "string");
}

async function expandInto(
  ctx: Ctx,
  data: JsonObject,
  type: string,
  paths: readonly string[],
): Promise<JsonObject> {
  const out: JsonObject = structuredClone(data);
  const allowed = EXPANDABLE[type] ?? {};
  const heads = new Map<string, string[]>();
  for (const path of paths) {
    const [head = "", ...rest] = path.split(".");
    const rests = heads.get(head) ?? [];
    if (rest.length > 0) rests.push(rest.join("."));
    heads.set(head, rests);
  }
  for (const [head, rests] of heads) {
    const childType = allowed[head];
    if (childType === undefined) {
      throw invalidRequest(`This property cannot be expanded (${head}).`, { param: "expand" });
    }
    const id = out[head];
    if (typeof id !== "string") continue;
    const child = await load(ctx, id, childType, { unscoped: true });
    out[head] = await expandInto(ctx, child.data, childType, rests);
  }
  return out;
}

/** The response body for an object, honouring `expand[]`. */
export async function render(ctx: Ctx, o: StoredObject, params: ParamObject): Promise<JsonObject> {
  const paths = expandPaths(params);
  return paths.length === 0 ? o.data : expandInto(ctx, o.data, o.type, paths);
}

export async function ok(ctx: Ctx, o: StoredObject, params: ParamObject): Promise<Out> {
  return { body: await render(ctx, o, params) };
}
