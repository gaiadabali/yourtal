import type { ReactNode } from "react";

import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";
import { getMerchantDevice } from "@/features/merchant/merchant-data";

/**
 * Root layout for the merchant portal (YT-0181).
 *
 * This group had no layout of its own and inherited `<html>` from the old
 * shared `app/layout.tsx`. That file is gone — see `app/root-document.tsx`
 * for why — so the group needs one, and the only real question it raises
 * is which `lang` to declare.
 *
 * TASKS.md 8.1/8.2 REWRITE: `lang` follows the paired device's own locale
 * again, read off the binding cookie (`getMerchantDevice()`,
 * `merchant-device.ts`'s own doc comment on the now-closed device-info
 * gap) — `"en-AU"` only for an unpaired browser (the `/merchant/pair`
 * screens) or a paired device that has not yet had its first real
 * unlock-with-PIN call.
 */

export const metadata = baseMetadata;
export const viewport = baseViewport;

export interface MerchantLayoutProps {
  children: ReactNode;
}

export default async function MerchantLayout({ children }: MerchantLayoutProps) {
  const device = await getMerchantDevice();
  return <RootDocument lang={device?.locale ?? "en-AU"}>{children}</RootDocument>;
}
