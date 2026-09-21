/**
 * Inert stand-in for the `server-only` marker package under Vitest.
 *
 * `server-only` ships two entries and picks between them with an `exports`
 * condition: `react-server` resolves to an empty module, anything else to
 * one whose only statement is `throw new Error("This module cannot be
 * imported from a Client Component module.")`. Next sets that condition
 * when it builds the server graph; Vitest does not set it at all, so every
 * test that imports a `server-only` module gets the throwing entry and
 * fails at import time.
 *
 * Setting `resolve.conditions: ["react-server"]` globally would fix it and
 * is the wrong tool: React itself ships a `react-server` entry, so that
 * flag would quietly swap React's build under every jsdom test in the suite
 * to fix three files.
 *
 * A unit test is neither a server nor a client — it is a module graph with
 * no renderer — so the marker has nothing to assert and should simply be
 * inert. The real boundary is enforced where it can actually be observed,
 * by `next build`, and proved there by sabotage: see
 * `features/README-server-only.md`.
 */
export {};
