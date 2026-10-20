import { type ParamObject, type ParamValue, isParamObject } from "./form";
import { invalidInteger, invalidRequest, missingParam } from "./errors";

/** `["line_items","0","price_data"]` -> `line_items[0][price_data]`. */
export function paramName(path: readonly string[]): string {
  const [head = "", ...rest] = path;
  return head + rest.map((s) => `[${s}]`).join("");
}

function at(p: ParamObject, path: readonly string[]): ParamValue | undefined {
  let cur: ParamValue | undefined = p;
  for (const seg of path) {
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (isParamObject(cur)) cur = cur[seg];
    else return undefined;
  }
  return cur;
}

/** A string param; an empty string means "unset", as at Stripe. */
export function str(p: ParamObject, ...path: string[]): string | undefined {
  const v = at(p, path);
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw invalidRequest(`Invalid string: ${paramName(path)}`, { param: paramName(path) });
  }
  return v === "" ? undefined : v;
}

export function reqStr(p: ParamObject, ...path: string[]): string {
  const v = str(p, ...path);
  if (v === undefined) throw missingParam(paramName(path));
  return v;
}

export function int(p: ParamObject, ...path: string[]): number | undefined {
  const v = str(p, ...path);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!/^-?\d+$/.test(v) || !Number.isSafeInteger(n)) throw invalidInteger(paramName(path), v);
  return n;
}

export function reqInt(p: ParamObject, ...path: string[]): number {
  const v = int(p, ...path);
  if (v === undefined) throw missingParam(paramName(path));
  return v;
}

export function bool(p: ParamObject, ...path: string[]): boolean | undefined {
  const v = str(p, ...path);
  if (v === undefined) return undefined;
  if (v !== "true" && v !== "false") {
    throw invalidRequest(`Invalid boolean: ${v.slice(0, 20)}`, { param: paramName(path) });
  }
  return v === "true";
}

export function obj(p: ParamObject, ...path: string[]): ParamObject | undefined {
  const v = at(p, path);
  return isParamObject(v) ? v : undefined;
}

export function list(p: ParamObject, ...path: string[]): ParamValue[] | undefined {
  const v = at(p, path);
  return Array.isArray(v) ? v : undefined;
}

/** `metadata[k]=v` pairs. An empty value is kept: callers decide what it means. */
export function metadata(p: ParamObject, ...path: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const o = obj(p, ...path);
  if (o === undefined) return out;
  for (const [k, v] of Object.entries(o)) if (typeof v === "string") out[k] = v;
  return out;
}

export function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return allowed.find((a) => a === value);
}
