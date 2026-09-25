import { BrandWordmark } from "@yourtal/ui/brand/wordmark";

export interface WordmarkProps {
  className?: string;
}

/**
 * The viewer top bar's wordmark (task 3.5.c), now the real brand mark
 * (task 3.6.a): `@yourtal/ui/brand/wordmark` is the one source `PointsChip`
 * and every other wordmark on the site share, so a coin and "YourTal" mean
 * the same thing everywhere they appear.
 */
export function Wordmark({ className }: WordmarkProps) {
  return <BrandWordmark size="sm" className={className} />;
}
