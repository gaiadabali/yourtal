import { randomUUID } from "node:crypto";

/**
 * One rate-limit namespace per test file. `with-test-db.mjs` sets a single
 * namespace for the whole run, so the route-wide caps (500 registrations an
 * hour, `REGISTER_RATE_LIMIT`) counted every file's `sessionFor` together and
 * started refusing once the suite grew past them. A file's own tests still
 * share one namespace, so a test of a limit sees its own earlier calls.
 */
process.env["RATE_LIMIT_NAMESPACE"] =
  `${process.env["RATE_LIMIT_NAMESPACE"] ?? "test"}:${randomUUID().slice(0, 8)}`;
