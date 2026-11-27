import { BrandLogo } from "@yourtal/ui/brand/wordmark";

export interface WordmarkProps {
  className?: string;
}

/** The shell's logo (top bar and side rail): the lockup where it fits, the submark below. */
export function Wordmark({ className }: WordmarkProps) {
  return <BrandLogo className={className} />;
}
