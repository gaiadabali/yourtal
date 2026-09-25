import type { ReactNode } from "react";

import { readDeviceBinding } from "@/features/merchant/provisioning/device-session-cookie";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";

/**
 * Root layout for the merchant portal (YT-0181).
 *
 * This group had no layout of its own and inherited `<html>` from the old
 * shared `app/layout.tsx`. That file is gone — see `app/root-document.tsx`
 * for why — so the group needs one, and the only real question it raises
 * is which `lang` to declare.
 *
 * `lang` follows the paired device's own locale: a device belongs to one
 * merchant in one region. Unpaired, it falls back to `en-AU`, the default.
 */

export const metadata = baseMetadata;
export const viewport = baseViewport;

export interface MerchantLayoutProps {
  children: ReactNode;
}

export default async function MerchantLayout({ children }: MerchantLayoutProps) {
  const binding = await readDeviceBinding();
  const lang = binding?.locale ?? "en-AU";
  return <RootDocument lang={lang}>{children}</RootDocument>;
}
