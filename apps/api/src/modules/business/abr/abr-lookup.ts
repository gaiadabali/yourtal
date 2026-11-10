/**
 * 6.10.b: the ABR's free "ABN Lookup" web service, behind an interface. It needs
 * a GUID (`ABR_GUID`); with none set the driver is OFF (`createAbrLookup` returns
 * `null`) and nothing here ever touches the network. Tests use `FakeAbrLookup`.
 */
export type AbrResult =
  | { readonly found: true; readonly entityName: string; readonly gstRegistered: boolean }
  | { readonly found: false };

export interface AbrLookup {
  /** `abn` is 11 digits, already check-digit valid. Throws when the ABR cannot be reached. */
  lookup(abn: string): Promise<AbrResult>;
}

export const ABR_LOOKUP = Symbol("ABR_LOOKUP");

const ABR_ENDPOINT = "https://abr.business.gov.au/json/AbnDetails.aspx";

/** The live driver. The ABR answers JSONP (`callback({...})`); the wrapper is stripped. */
export class HttpAbrLookup implements AbrLookup {
  constructor(
    private readonly guid: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async lookup(abn: string): Promise<AbrResult> {
    const url = `${ABR_ENDPOINT}?abn=${encodeURIComponent(abn)}&callback=c&guid=${encodeURIComponent(this.guid)}`;
    const response = await this.fetchFn(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`ABR answered ${String(response.status)}`);
    const body = (await response.text()).trim();
    const json = /^[\w$]*\(([\s\S]*)\)\s*;?$/.exec(body)?.[1] ?? body;
    const data = JSON.parse(json) as {
      AbnStatus?: string;
      EntityName?: string;
      Gst?: string | null;
      Message?: string;
    };
    if (
      data.AbnStatus !== "Active" ||
      typeof data.EntityName !== "string" ||
      data.EntityName === ""
    ) {
      return { found: false };
    }
    // `Gst` is the date GST registration took effect, null when not registered.
    return {
      found: true,
      entityName: data.EntityName,
      gstRegistered: typeof data.Gst === "string" && data.Gst !== "",
    };
  }
}

/** A canned register for tests and for a dev stack that wants the staff action without the network. */
export class FakeAbrLookup implements AbrLookup {
  readonly calls: string[] = [];
  constructor(private readonly register: ReadonlyMap<string, AbrResult> = new Map()) {}

  lookup(abn: string): Promise<AbrResult> {
    this.calls.push(abn);
    return Promise.resolve(this.register.get(abn) ?? { found: false });
  }
}

/** OFF (`null`) unless a GUID is set. */
export function createAbrLookup(guid: string | undefined): AbrLookup | null {
  return guid === undefined || guid.trim() === "" ? null : new HttpAbrLookup(guid.trim());
}
