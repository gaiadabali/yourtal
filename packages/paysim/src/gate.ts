/**
 * The simulation impersonates Stripe, so it must never run where real money
 * could be expected. Called at boot by the API and again by `registerPaySim`.
 */
export function assertPaySimAllowed(appEnv: string): void {
  if (appEnv.trim().toLowerCase() === "production") {
    throw new Error("The payment simulation must never run with APP_ENV=production.");
  }
}
