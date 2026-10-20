/**
 * How the person signed in to YourTal, for the ID token's `amr` (docs/26 §1.3).
 * A YourTal session only knows passwords today. Passkeys and authenticator
 * codes (group 3.9.c) change this one function, and nothing else here.
 */
export function sessionAmr(): string[] {
  return ["pwd"];
}
