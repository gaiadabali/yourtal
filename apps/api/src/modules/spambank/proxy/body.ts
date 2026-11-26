import type { IncomingMessage } from "node:http";

/**
 * Request bodies of the mail API, read by the routes themselves: the scope's parsers leave every
 * body unread so uploads can stream, and the JSON routes read theirs here with their own limit.
 */

export class BodyTooLarge extends Error {
  constructor() {
    super("The request body is too large.");
  }
}

/** Declared length, when the client sent one that parses. */
export function declaredLength(raw: IncomingMessage): number | undefined {
  const header = raw.headers["content-length"];
  if (header === undefined) return undefined;
  const n = Number.parseInt(header, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Reads the whole body, refusing (and draining nothing further) past `limit` bytes. */
export async function readBody(raw: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = declaredLength(raw);
  if (declared !== undefined && declared > limit) throw new BodyTooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of raw) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > limit) {
      raw.destroy();
      throw new BodyTooLarge();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** The body as JSON, or undefined when it is empty or not JSON. */
export async function readJson(raw: IncomingMessage, limit: number): Promise<unknown> {
  const bytes = await readBody(raw, limit);
  if (bytes.length === 0) return undefined;
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return value;
  } catch {
    return undefined;
  }
}

/** A stream that errors once more than `limit` bytes have passed through it. */
export function limitStream(
  limit: number,
  onTooLarge: () => void,
): TransformStream<Uint8Array, Uint8Array> {
  let size = 0;
  return new TransformStream({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) {
        onTooLarge();
        controller.error(new BodyTooLarge());
        return;
      }
      controller.enqueue(chunk);
    },
  });
}
