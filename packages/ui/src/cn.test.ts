import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn knows the v2 token vocabulary", () => {
  it("keeps a type role and a colour together", () => {
    expect(cn("text-fg text-display-lg")).toBe("text-fg text-display-lg");
  });

  it("resolves real conflicts within each scale", () => {
    expect(cn("text-caption", "text-body")).toBe("text-body");
    expect(cn("text-fg", "text-danger-solid")).toBe("text-danger-solid");
    expect(cn("rounded-md", "rounded-card")).toBe("rounded-card");
    expect(cn("shadow-md", "shadow-2")).toBe("shadow-2");
    expect(cn("bg-primary", "bg-accent")).toBe("bg-accent");
  });

  it("treats a border width and a border colour as different things", () => {
    expect(cn("border", "border-border-subtle")).toBe("border border-border-subtle");
    expect(cn("border-border", "border-border-subtle")).toBe("border-border-subtle");
  });
});
