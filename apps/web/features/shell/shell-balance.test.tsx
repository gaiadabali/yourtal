import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ShellBalanceProvider, useAdoptShellBalance, useShellBalance } from "./shell-balance";

let adoptNow: (points: number) => void = () => undefined;

function Chip({ server }: { server: number }) {
  adoptNow = useAdoptShellBalance();
  return <output>{useShellBalance(server)}</output>;
}

describe("ShellBalanceProvider", () => {
  it("shows the server's balance until a flow adopts a newer one", () => {
    render(
      <ShellBalanceProvider serverPoints={630}>
        <Chip server={630} />
      </ShellBalanceProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("630");

    act(() => adoptNow(480));
    expect(screen.getByRole("status")).toHaveTextContent("480");
  });

  it("lets the next server read win over an adopted figure", () => {
    const { rerender } = render(
      <ShellBalanceProvider serverPoints={630}>
        <Chip server={630} />
      </ShellBalanceProvider>,
    );
    act(() => adoptNow(480));
    rerender(
      <ShellBalanceProvider serverPoints={500}>
        <Chip server={500} />
      </ShellBalanceProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("500");
  });

  it("is harmless outside a shell: the fallback shows and adopting does nothing", () => {
    render(<Chip server={42} />);
    act(() => adoptNow(1));
    expect(screen.getByRole("status")).toHaveTextContent("42");
  });
});
