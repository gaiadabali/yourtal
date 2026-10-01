import "server-only";
import { headers } from "next/headers";

/**
 * 13.3.e: the viewer's address, as nginx handed it to this server (it sets
 * X-Forwarded-For to the TCP peer, overwriting anything the client sent). The
 * api believes X-Forwarded-For only from a loopback hop, so passing it on gives
 * each viewer their own rate-limit bucket instead of one shared 127.0.0.1.
 */
export async function forwardViewerAddress(target: Headers): Promise<void> {
  let address: string | null;
  try {
    const incoming = await headers();
    address = incoming.get("x-real-ip") ?? incoming.get("x-forwarded-for");
  } catch {
    // Outside a request (a build or a test): nobody to forward.
    return;
  }
  const first = address?.split(",")[0]?.trim();
  if (first !== undefined && first.length > 0) target.set("x-forwarded-for", first);
}
