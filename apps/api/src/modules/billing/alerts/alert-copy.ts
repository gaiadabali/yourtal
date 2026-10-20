import type { AlertKind, Threshold } from "./budget-alert.repository";

/** F121: alert at half, most and all of a package or a campaign budget used. */
export const THRESHOLDS: readonly Threshold[] = [50, 80, 100];

/** Every threshold `used` of `total` has reached, in exact integers. */
export function reachedThresholds(usedPoints: number, totalPoints: number): Threshold[] {
  if (totalPoints <= 0) return [];
  return THRESHOLDS.filter((pct) => usedPoints * 100 >= pct * totalPoints);
}

export interface AlertFacts {
  readonly kind: AlertKind;
  readonly thresholdPct: Threshold;
  readonly usedPoints: number;
  readonly totalPoints: number;
  readonly campaignTitle: string | null;
}

type Locale = "en-AU" | "id-ID";

/** Subject and body of an alert email, in the recipient's language. */
export function alertEmail(locale: Locale, facts: AlertFacts): { subject: string; body: string } {
  const n = new Intl.NumberFormat(locale);
  const total = n.format(facts.totalPoints);
  const left = n.format(Math.max(0, facts.totalPoints - facts.usedPoints));
  const used = n.format(facts.usedPoints);
  const pct = facts.thresholdPct;
  const title = facts.campaignTitle ?? (locale === "id-ID" ? "Anda" : "Your campaign");
  const full = pct === 100;

  if (locale === "id-ID") {
    if (facts.kind === "package") {
      return full
        ? {
            subject: "Paket poin Anda sudah habis",
            body: `Paket ${total} poin Anda sudah terpakai seluruhnya, jadi kampanye yang didanainya berhenti memberi hadiah. Beli paket lain di Penagihan Studio untuk memulainya lagi.`,
          }
        : {
            subject: `Paket poin Anda sudah terpakai ${String(pct)}%`,
            body: `Paket ${total} poin Anda sudah terpakai ${String(pct)}%: tersisa ${left} poin. Beli paket lain di Penagihan Studio agar kampanye Anda terus memberi hadiah kepada penonton.`,
          };
    }
    return full
      ? {
          subject: `Kampanye "${title}" sudah memakai seluruh anggarannya`,
          body: `Kampanye "${title}" sudah memberikan seluruh anggaran ${total} poinnya, jadi kampanye ini berhenti memberi hadiah. Naikkan anggarannya di Studio agar terus memberi hadiah kepada penonton.`,
        }
      : {
          subject: `Kampanye "${title}" sudah memakai ${String(pct)}% anggarannya`,
          body: `Kampanye "${title}" sudah memberikan ${used} dari anggaran ${total} poin. Tersisa ${left} poin.`,
        };
  }

  if (facts.kind === "package") {
    return full
      ? {
          subject: "Your points package is used up",
          body: `Your package of ${total} points is fully used, so the campaigns it funds have stopped giving rewards. Buy another package in Studio Billing to start them again.`,
        }
      : {
          subject: `Your points package is ${String(pct)}% used`,
          body: `Your package of ${total} points is ${String(pct)}% used: ${left} points are left. Buy another package in Studio Billing to keep your campaigns rewarding viewers.`,
        };
  }
  return full
    ? {
        subject: `Campaign "${title}" has used its whole budget`,
        body: `Campaign "${title}" has given out its whole budget of ${total} points, so it has stopped giving rewards. Raise its budget in Studio to keep it rewarding viewers.`,
      }
    : {
        subject: `Campaign "${title}" has used ${String(pct)}% of its budget`,
        body: `Campaign "${title}" has given out ${used} of its ${total}-point budget. ${left} points are left.`,
      };
}
