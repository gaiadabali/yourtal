import { Injectable } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { FastifyInstance } from "fastify";

/**
 * 1.6.n: a client that sets `content-type: application/json` on a DELETE with
 * no body (a common fetch wrapper default) got a 400 "Body cannot be empty"
 * from Fastify's JSON parser, though a DELETE has nothing to parse. For that
 * one case, a DELETE that declares JSON but sends no bytes, the header is
 * dropped before parsing so the request is treated as body-less. Every other
 * method, and a DELETE that does send a body, is parsed and validated as
 * before, so an empty POST or PUT body is still a 400.
 */
export function dropJsonTypeFromEmptyDelete(headers: Record<string, unknown>, method: string) {
  if (method !== "DELETE") return;
  const length = headers["content-length"];
  const noBytes = (length === undefined || length === "0") && !("transfer-encoding" in headers);
  if (noBytes && "content-type" in headers) delete headers["content-type"];
}

export function registerEmptyDeleteBody(instance: FastifyInstance): void {
  instance.addHook("onRequest", (request, _reply, done) => {
    dropJsonTypeFromEmptyDelete(request.headers, request.method);
    done();
  });
}

/** Registers the hook on the app's Fastify instance as the app initialises, so `main.ts` and every test app built from `AppModule` behave the same. */
@Injectable()
export class EmptyDeleteBodyHook implements OnModuleInit {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onModuleInit(): void {
    const instance = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
    registerEmptyDeleteBody(instance);
  }
}
