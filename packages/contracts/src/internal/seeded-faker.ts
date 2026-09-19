import { Faker, en, id_ID } from "@faker-js/faker";

/**
 * Creates a fresh, explicitly seeded Faker instance. Never import or use the
 * package-level `faker` singleton from `@faker-js/faker` in this package —
 * it carries global mutable state that different generators would fight
 * over, which is exactly the kind of thing that turns "deterministic" into
 * "deterministic until someone adds a second call site."
 *
 * `faker.seed(seed)` drives Faker's Mersenne53 randomizer, which is a pure
 * JS algorithm with no platform-dependent behaviour, so the same seed
 * produces the same sequence of values on any machine.
 *
 * Locale is Indonesian first, English as fallback for the (few) Faker
 * modules without full `id_ID` data.
 */
export function createSeededFaker(seed: number): Faker {
  const faker = new Faker({ locale: [id_ID, en] });
  faker.seed(seed);
  return faker;
}
