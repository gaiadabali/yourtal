import { inflateSync } from "node:zlib";

/**
 * The text pdfkit wrote, read back out of the file: every content stream is
 * inflated and its `TJ`/`Tj` operators decoded. Standard fonts write each
 * string as hex of single-byte codes, so no font program is needed to read it.
 * Used by tests to show a PDF really carries what the invoice says.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const strings: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const body = match[1] ?? "";
    let content: string;
    try {
      content = inflateSync(Buffer.from(body, "latin1")).toString("latin1");
    } catch {
      content = body;
    }
    for (const op of content.matchAll(
      /\[((?:<[0-9a-fA-F]*>|[^\]<])*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g,
    )) {
      const hex =
        op[2] ??
        [...(op[1] ?? "").matchAll(/<([0-9a-fA-F]*)>/g)].map((piece) => piece[1] ?? "").join("");
      strings.push(Buffer.from(hex, "hex").toString("latin1"));
    }
  }
  return strings.join("\n");
}
