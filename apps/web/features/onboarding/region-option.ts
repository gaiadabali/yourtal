import type { Region } from "@yourtal/contracts/region";

/**
 * The two regions offered at registration (docs/tasks/phase-u-ui.md YT-0430's
 * region criterion, added at the founder's explicit request: "YourTal runs
 * two regions, Australia and Indonesia, and the user picks one at
 * registration"). Deliberately does NOT duplicate `countryName` or
 * `currency` — `region-picker.tsx` reads those straight from the real
 * `REGION_CONFIG` (a Server Component, so the Zod-adjacent value import is
 * free). Only the illustrative example amount and the bilingual tagline are
 * this feature's own content.
 *
 * `exampleAmountMinor` is a made-up, clearly-labelled illustration (see
 * `region-picker.tsx`: "Example reward / Contoh hadiah"), never a real quote
 * — docs/03-regulatory-and-risk.md section 3.3b: a forward statement about
 * redemption or reward value needs a reasonable basis we do not have yet
 * (the Scoopon precedent), so this must read as an example, not a claim.
 */
export interface RegionOption {
  readonly region: Region;
  readonly taglineEn: string;
  readonly taglineId: string;
  readonly exampleAmountMinor: number;
}

export const REGION_OPTIONS: readonly RegionOption[] = [
  {
    region: "AU",
    taglineEn: "The main market — AUD pricing and Australian consumer protections.",
    taglineId: "Pasar utama — harga dalam AUD dan perlindungan konsumen Australia.",
    exampleAmountMinor: 1250,
  },
  {
    region: "ID",
    taglineEn: "Our proving ground — IDR pricing, Bahasa Indonesia throughout.",
    taglineId: "Pasar uji coba kami — harga dalam IDR, seluruhnya dalam Bahasa Indonesia.",
    exampleAmountMinor: 45_000,
  },
];
