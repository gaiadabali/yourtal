import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const { readSessionToken } = vi.hoisted(() => ({ readSessionToken: vi.fn() }));
vi.mock("@/lib/api/session-cookies", () => ({ readSessionToken }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));

import PasskeyPromptPage from "./page";

async function props(query: Record<string, string>) {
  const ui = (await PasskeyPromptPage({ searchParams: Promise.resolve(query) })) as ReactElement<{
    title: string;
    description: string;
    children: ReactElement<{ returnTo: string; reason?: string }>;
  }>;
  return {
    title: ui.props.title,
    description: ui.props.description,
    prompt: ui.props.children.props,
  };
}

beforeEach(() => readSessionToken.mockResolvedValue("tok"));

describe("/passkey", () => {
  it("keeps the faster-sign-in copy without reason=earn", async () => {
    const r = await props({ returnTo: "/wallet" });
    expect(r).toMatchObject({ title: "heading", description: "body" });
    expect(r.prompt).toEqual({ returnTo: "/wallet", reason: undefined });
  });

  it("uses the earning copy for reason=earn with a safe returnTo", async () => {
    const r = await props({ returnTo: "/watch/c1", reason: "earn" });
    expect(r).toMatchObject({ title: "earnHeading", description: "earnBody" });
    expect(r.prompt).toEqual({ returnTo: "/watch/c1", reason: "earn" });
  });

  it("refuses an off-site returnTo: goes to / and does not treat it as the earning prompt", async () => {
    const r = await props({ returnTo: "//evil.com", reason: "earn" });
    expect(r.title).toBe("heading");
    expect(r.prompt).toEqual({ returnTo: "/", reason: undefined });
  });

  it("ignores any other reason value", async () => {
    expect((await props({ returnTo: "/wallet", reason: "x" })).title).toBe("heading");
  });

  it("sends a signed-out visitor to /login", async () => {
    readSessionToken.mockResolvedValue(null);
    await expect(props({ returnTo: "/wallet", reason: "earn" })).rejects.toThrow("redirect:/login");
  });
});
