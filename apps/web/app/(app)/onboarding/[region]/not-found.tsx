import Link from "next/link";
import { Button } from "@yourtal/ui/button";

/** Reached when `requireRegionParam` 404s an unrecognised `[region]` segment. */
export default function OnboardingRegionNotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-xl font-sans font-semibold text-fg">
        Region not recognised / Wilayah tidak dikenali
      </h1>
      <p className="text-sm font-sans text-fg-muted">
        Please pick your region again. / Silakan pilih wilayahmu lagi.
      </p>
      <Button asChild>
        <Link href="/onboarding">Start over / Mulai lagi</Link>
      </Button>
    </div>
  );
}
