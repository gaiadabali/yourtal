/**
 * Stripe's form encoding: `a[b][0][c]=v`, `expand[]=x`. Also used for query
 * strings. Output is a tree of strings, arrays and null-prototype objects.
 */
export type ParamValue = string | ParamValue[] | ParamObject;
export interface ParamObject {
  [key: string]: ParamValue;
}

export class FormError extends Error {}

const MAX_PAIRS = 500;
const MAX_DEPTH = 8;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

function decode(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, " "));
  } catch {
    throw new FormError("Invalid form encoding");
  }
}

/** `a[b][]` -> ["a", "b", ""]. */
function segments(key: string): string[] {
  const head = /^[^[]+/.exec(key)?.[0];
  if (head === undefined) throw new FormError("Invalid parameter name");
  const out = [head];
  let rest = key.slice(head.length);
  while (rest.length > 0) {
    const m = /^\[([^\]]*)\]/.exec(rest);
    if (m === null) throw new FormError("Invalid parameter name");
    out.push(m[1] ?? "");
    rest = rest.slice(m[0].length);
  }
  if (out.length > MAX_DEPTH) throw new FormError("Parameters are nested too deeply");
  return out;
}

export function isParamObject(v: ParamValue | undefined): v is ParamObject {
  return typeof v === "object" && !Array.isArray(v);
}

function newObject(): ParamObject {
  return Object.create(null) as ParamObject;
}

/** Objects keyed 0..n become arrays, in index order. */
function arrayify(v: ParamValue): ParamValue {
  if (typeof v === "string" || Array.isArray(v)) return v;
  const keys = Object.keys(v);
  for (const k of keys) v[k] = arrayify(v[k] as ParamValue);
  const indexed = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
  if (!indexed) return v;
  return keys
    .map(Number)
    .sort((a, b) => a - b)
    .map((n) => v[String(n)] as ParamValue);
}

function nextIndex(node: ParamObject): string {
  let max = -1;
  for (const k of Object.keys(node)) if (/^\d+$/.test(k)) max = Math.max(max, Number(k));
  return String(max + 1);
}

export function parseForm(raw: string): ParamObject {
  const root = newObject();
  if (raw === "") return root;
  const pairs = raw.split("&").filter((p) => p !== "");
  if (pairs.length > MAX_PAIRS) throw new FormError("Too many parameters");
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const key = decode(eq < 0 ? pair : pair.slice(0, eq));
    const value = eq < 0 ? "" : decode(pair.slice(eq + 1));
    const segs = segments(key);
    if (segs.some((s) => FORBIDDEN.has(s))) throw new FormError("Invalid parameter name");
    let node = root;
    segs.forEach((seg, i) => {
      // An empty `[]` appends to the array under this node.
      const slot = seg === "" ? nextIndex(node) : seg;
      if (i === segs.length - 1) {
        node[slot] = value;
        return;
      }
      const existing = node[slot];
      if (isParamObject(existing)) {
        node = existing;
      } else {
        const child = newObject();
        node[slot] = child;
        node = child;
      }
    });
  }
  const out = arrayify(root);
  return isParamObject(out) ? out : root;
}
