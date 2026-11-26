import { describe, expect, it } from "vitest";
import { BodyTooLarge, limitStream } from "./body";
import { attachmentDisposition } from "./jmap-routes";

describe("limitStream (the 25 MB upload cap without a Content-Length)", () => {
  async function pump(
    chunks: number[],
    limit: number,
  ): Promise<{ bytes: number; flagged: boolean }> {
    let flagged = false;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of chunks) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    });
    const out = source.pipeThrough(
      limitStream(limit, () => {
        flagged = true;
      }),
    );
    const bytes = (await new Response(out).arrayBuffer()).byteLength;
    return { bytes, flagged };
  }

  it("passes a body at the limit", async () => {
    expect(await pump([4, 4, 2], 10)).toEqual({ bytes: 10, flagged: false });
  });

  it("errors one byte over it", async () => {
    await expect(pump([4, 4, 3], 10)).rejects.toBeInstanceOf(BodyTooLarge);
  });
});

describe("attachmentDisposition", () => {
  it("always says attachment and keeps quotes and line breaks out of the name", () => {
    expect(attachmentDisposition('a"b\r\nc/d.pdf')).toBe(
      `attachment; filename="a_b__c_d.pdf"; filename*=UTF-8''a_b__c_d.pdf`,
    );
    expect(attachmentDisposition("Résumé.pdf")).toBe(
      `attachment; filename="R_sum_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf`,
    );
    expect(attachmentDisposition("")).toBe(
      `attachment; filename="attachment"; filename*=UTF-8''attachment`,
    );
  });
});
