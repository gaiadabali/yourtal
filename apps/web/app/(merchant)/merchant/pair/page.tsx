import type { Metadata } from "next";
import { DevicePairingForm } from "@/features/merchant/provisioning/device-pairing-form";

export const metadata: Metadata = { title: "Pair device · YourTal Merchant" };

/**
 * `/merchant/pair` (TASKS.md 8.1.a) — the one public page under
 * `/merchant`, per `apps/web/proxy.ts`'s `MERCHANT_PAIR_PATH`: a browser
 * with no `yt_device` cookie is redirected here, and only here, from
 * anywhere else in the group.
 */
export default async function MerchantPairPage({ searchParams }: PageProps<"/merchant/pair">) {
  const { error } = await searchParams;
  const errorParam = Array.isArray(error) ? error[0] : error;
  return <DevicePairingForm error={errorParam} />;
}
