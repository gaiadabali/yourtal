import type { FastifyRequest } from "fastify";
import type { Principal } from "@yourtal/authz/principal";

/**
 * The narrow shape every controller that only needs "who is calling"
 * actually depends on. `PrincipalService` implements this; so, structurally,
 * does `AsyncPrincipalResolver` (both expose exactly `resolve(request):
 * Promise<Principal>`). Controllers inject one or the other by CLASS (Nest
 * still needs a concrete token to resolve), typed as this interface —
 * `PrincipalService` has a private field as of 1.5.a (`SessionValidator`),
 * which means a plain object literal can no longer structurally satisfy the
 * class type the way `{ resolve: vi.fn() }` used to. Typing the field as
 * this interface instead keeps every existing duck-typed fake compiling
 * with no cast, which is the same reason `AsyncPrincipalResolver`'s own
 * class comment gives for staying a separate class from `PrincipalService`.
 */
export interface PrincipalResolver {
  resolve(request: FastifyRequest): Promise<Principal>;
}
