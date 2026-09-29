const STEPS = [
  {
    title: "Watch",
    body: "Pick a video from a local business — a couple of minutes, honestly labelled with its length and data cost before you start.",
  },
  {
    title: "Answer honestly",
    body: "A question or two along the way, about what you just watched. No trick questions, no personal ones.",
  },
  {
    title: "Earn and spend",
    body: "Points land in your wallet and unlock within a few days. Spend them on real vouchers at the businesses you watched.",
  },
] as const;

/** 11.1.a: "how it works in three steps." Plain, honest copy — no reward figures (those vary per video and per business). */
export function LandingHowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      className="flex flex-col gap-6 p-gutter-md md:p-12"
    >
      <h2 id="how-it-works-heading" className="font-display text-headline text-fg">
        How it works
      </h2>
      <ol className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-2 rounded-lg border border-border p-6">
            <span className="text-sm font-semibold text-fg-subtle">Step {index + 1}</span>
            <h3 className="text-title font-semibold text-fg">{step.title}</h3>
            <p className="text-sm text-fg-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
