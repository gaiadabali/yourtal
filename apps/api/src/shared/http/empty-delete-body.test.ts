import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerEmptyDeleteBody } from "./empty-delete-body";

let app: FastifyInstance | undefined;

async function build(withHook: boolean): Promise<FastifyInstance> {
  const instance = Fastify();
  if (withHook) registerEmptyDeleteBody(instance);
  instance.delete("/thing", (request) => ({ body: request.body ?? null }));
  instance.post("/thing", (request) => ({ body: request.body ?? null }));
  await instance.ready();
  app = instance;
  return instance;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const json = { "content-type": "application/json" };

describe("DELETE with an empty JSON body (1.6.n)", () => {
  it("is the defect: Fastify alone answers 400", async () => {
    const response = await (
      await build(false)
    ).inject({
      method: "DELETE",
      url: "/thing",
      headers: json,
    });
    expect(response.statusCode).toBe(400);
  });

  it("is accepted once the hook is registered", async () => {
    const response = await (
      await build(true)
    ).inject({
      method: "DELETE",
      url: "/thing",
      headers: json,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ body: null });
  });

  it("is accepted with an explicit zero content-length", async () => {
    const response = await (
      await build(true)
    ).inject({
      method: "DELETE",
      url: "/thing",
      headers: { ...json, "content-length": "0" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("still parses a DELETE that does send a JSON body, and still rejects bad JSON", async () => {
    const instance = await build(true);
    const ok = await instance.inject({
      method: "DELETE",
      url: "/thing",
      headers: json,
      payload: { reason: "x" },
    });
    expect(ok.json()).toEqual({ body: { reason: "x" } });
    const bad = await instance.inject({
      method: "DELETE",
      url: "/thing",
      headers: json,
      payload: "{not json",
    });
    expect(bad.statusCode).toBe(400);
  });

  it("does not loosen other methods: an empty JSON POST is still a 400", async () => {
    const response = await (
      await build(true)
    ).inject({
      method: "POST",
      url: "/thing",
      headers: json,
    });
    expect(response.statusCode).toBe(400);
  });
});
