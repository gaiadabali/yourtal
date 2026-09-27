import enAU from "@/messages/en-AU/wallet.json";
import idID from "@/messages/id-ID/wallet.json";
import type { Translator } from "./wallet-voucher-status-copy";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } as const;

/**
 * Test-only stand-in for next-intl's translator (`getTranslations` /
 * `useTranslations`), reading straight from the real `wallet` catalogues —
 * so a test asserting on `t("voucher.statusHeld")`'s output is asserting on
 * the actual shipped copy, not a placeholder. Good enough for this
 * feature's flat, non-pluralised keys; real ICU plural/select syntax is
 * out of scope for this stand-in.
 */
export function walletTestTranslator(locale: "en-AU" | "id-ID"): Translator {
  const catalogue = CATALOGUES[locale];
  return (key: string, values?: Record<string, string | number>) => {
    const raw = key
      .split(".")
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    if (typeof raw !== "string") {
      throw new Error(`wallet-test-translator: missing key "${key}" for ${locale}`);
    }
    if (!values) return raw;
    return raw.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? ""));
  };
}
