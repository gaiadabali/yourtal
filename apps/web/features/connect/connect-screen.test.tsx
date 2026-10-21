import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { InteractionDetails } from "@yourtal/contracts/oidc/interaction";
import enAU from "@/messages/en-AU/connect.json";
import idID from "@/messages/id-ID/connect.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type Answer = Promise<unknown>;
const consentContinueAction = vi.fn<(uid: string) => Answer>();
const oneTapContinueAction = vi.fn<(uid: string) => Answer>();
const cancelAction = vi.fn<(uid: string) => Answer>();
const switchAccountAction = vi.fn<() => Answer>();
const resendVerificationAction = vi.fn<() => Answer>();
vi.mock("./connect-actions", () => ({
  consentContinueAction: (uid: string): Answer => consentContinueAction(uid),
  oneTapContinueAction: (uid: string): Answer => oneTapContinueAction(uid),
  cancelAction: (uid: string): Answer => cancelAction(uid),
  switchAccountAction: (): Answer => switchAccountAction(),
  resendVerificationAction: (): Answer => resendVerificationAction(),
}));

const navigateTo = vi.fn<(url: string) => void>();
vi.mock("./connect-navigate", () => ({ navigateTo: (url: string): void => navigateTo(url) }));

const { details } = await import("./connect-fixtures");
const { ConnectScreen } = await import("./connect-screen");
const { ConnectEndedView, ConnectUnavailableView } = await import("./connect-notice-views");

function renderScreen(value: InteractionDetails, locale: "en-AU" | "id-ID" = "en-AU") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ connect: locale === "en-AU" ? enAU : idID }}
    >
      <ConnectScreen details={value} />
    </NextIntlClientProvider>,
  );
}

function renderEn(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ connect: enAU }}>
      {node}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("login and create", () => {
  it("login leads with Sign in and links to /login and /register with the way back", () => {
    renderScreen(details({ screen: "login", account: null, sharing: null }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Sign in to continue to SnapApp" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("SnapApp uses your YourTal account to sign you in."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fconnect%2Fuid_123-abc",
    );
    expect(screen.getByText(/New to YourTal\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register?returnTo=%2Fconnect%2Fuid_123-abc",
    );
  });

  it("create leads with Create an account", () => {
    renderScreen(details({ screen: "create", account: null, sharing: null }));
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register?returnTo=%2Fconnect%2Fuid_123-abc",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fconnect%2Fuid_123-abc",
    );
  });
});

describe("verify_email", () => {
  const verify = details({ screen: "verify_email", sharing: null });

  it("says where the link went, and reloads the details once it is confirmed", async () => {
    renderScreen(verify);
    expect(screen.getByRole("heading", { level: 1, name: "Check your email" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "We sent a link to ana@example.com. Open it to confirm it's yours, then you'll go on to SnapApp.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I've confirmed my email" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("resends and confirms it; a throttled resend says to wait", async () => {
    resendVerificationAction.mockResolvedValueOnce({ kind: "sent" });
    renderScreen(verify);
    fireEvent.click(screen.getByRole("button", { name: "Send the link again" }));
    expect(
      await screen.findByText("We've sent a new link to ana@example.com."),
    ).toBeInTheDocument();

    resendVerificationAction.mockResolvedValueOnce({ kind: "throttled" });
    fireEvent.click(screen.getByRole("button", { name: "Send the link again" }));
    expect(
      await screen.findByText("You asked a moment ago. Wait a few minutes, then try again."),
    ).toBeInTheDocument();
  });
});

describe("consent", () => {
  it("shows what an adult in Australia shares, and what is never shared", () => {
    renderScreen(details());
    expect(
      screen.getByRole("heading", { level: 1, name: "Continue to SnapApp as Ana" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByText("Not you?")).toBeInTheDocument();
    expect(screen.getByText("SnapApp will get:")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "your name and email address",
      "that you're 18 or over",
      "that your YourTal account is for Australia",
    ]);
    expect(
      screen.getByText("It won't get your date of birth, your password or your points."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "https://snap-apps.gaiada.com/privacy",
    );
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "https://snap-apps.gaiada.com/terms",
    );
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(
      screen.getByText("You can remove SnapApp at any time in YourTal, under Me → Linked apps."),
    ).toBeInTheDocument();
    expect(screen.getByText("You'll go back to snap-apps.gaiada.com.")).toBeInTheDocument();
  });

  it("shows the teen line and the Indonesia line from sharing", () => {
    renderScreen(
      details({
        sharing: { claims: ["name", "email", "age_band", "region"], ageBand: "teen", region: "ID" },
      }),
    );
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toContain("that you're under 18");
    expect(items).toContain("that your YourTal account is for Indonesia");
    expect(items).not.toContain("that you're 18 or over");
  });

  it("lists only the claims the app is given", () => {
    renderScreen(details({ sharing: { claims: ["email"], ageBand: "adult", region: "AU" } }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "your email address",
    ]);
  });

  it("names the operator when it differs from the app's name", () => {
    renderScreen(details());
    expect(
      screen.getByText(
        "SnapApp is run by Gaiada Pty Ltd. Its privacy policy explains how it uses your details.",
      ),
    ).toBeInTheDocument();
  });

  it("drops the operator clause when the operator is the brand name", () => {
    renderScreen(details({ client: { ...details().client, operator: "SnapApp" } }));
    expect(screen.queryByText(/is run by/)).not.toBeInTheDocument();
    expect(
      screen.getByText("The privacy policy of SnapApp explains how it uses your details."),
    ).toBeInTheDocument();
  });

  it("says an external app is not run by YourTal, with or without a legal name", () => {
    const base = details().client;
    const { unmount } = renderScreen(
      details({
        client: {
          ...base,
          name: "Free Tax Returns",
          operator: "Free Tax Returns",
          externalOperator: true,
        },
      }),
    );
    expect(screen.getByText(/^Free Tax Returns isn't run by YourTal\./)).toBeInTheDocument();
    expect(screen.queryByText(/is run by/)).not.toBeInTheDocument();
    unmount();

    renderScreen(
      details({
        client: {
          ...base,
          name: "Free Tax Returns",
          operator: "Benjamin Charles Group",
          externalOperator: true,
        },
      }),
    );
    expect(
      screen.getByText(/^Free Tax Returns is run by Benjamin Charles Group, not by YourTal\./),
    ).toBeInTheDocument();
  });

  it("Continue posts the screen it was tapped on, then navigates the browser to redirectTo", async () => {
    consentContinueAction.mockResolvedValueOnce({
      kind: "redirect",
      redirectTo: "https://y.test/oidc/auth/x",
    });
    renderScreen(details());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith("https://y.test/oidc/auth/x"));
    expect(consentContinueAction).toHaveBeenCalledWith("uid_123-abc");
    expect(oneTapContinueAction).not.toHaveBeenCalled();
    // The buttons stay off while the browser leaves.
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("Cancel navigates to what cancel answers", async () => {
    cancelAction.mockResolvedValueOnce({
      kind: "redirect",
      redirectTo: "https://y.test/oidc/auth/c",
    });
    renderScreen(details());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith("https://y.test/oidc/auth/c"));
    expect(cancelAction).toHaveBeenCalledWith("uid_123-abc");
  });

  it("reloads the details when the sign-in changed under the person", async () => {
    consentContinueAction.mockResolvedValueOnce({ kind: "reload" });
    renderScreen(details());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(navigateTo).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });

  it("says so when it fails, and lets the person try again", async () => {
    consentContinueAction.mockResolvedValueOnce({ kind: "error" });
    renderScreen(details());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("Use another account signs out and reloads", async () => {
    switchAccountAction.mockResolvedValueOnce({ kind: "reload" });
    renderScreen(details());
    fireEvent.click(screen.getByRole("button", { name: "Use another account" }));
    await waitFor(() => expect(switchAccountAction).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("continue", () => {
  const oneTap = details({
    screen: "continue",
    sharing: { claims: ["name"], ageBand: "adult", region: "AU" },
  });

  it("is the one-tap screen: who, which app, Continue and Cancel, nothing else", () => {
    renderScreen(oneTap);
    expect(
      screen.getByRole("heading", { level: 1, name: "Continue to SnapApp as Ana" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use another account" })).toBeInTheDocument();
    expect(screen.queryByText("SnapApp will get:")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Privacy policy" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("calls the one-tap action, never the consent one", async () => {
    oneTapContinueAction.mockResolvedValueOnce({ kind: "reload" });
    renderScreen(oneTap);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(oneTapContinueAction).toHaveBeenCalledWith("uid_123-abc"));
    expect(consentContinueAction).not.toHaveBeenCalled();
  });
});

describe("refused", () => {
  const cases = [
    ["account_on_hold", "Your YourTal account is on hold", /Contact YourTal support/],
    ["region_not_supported", "SnapApp isn't available for your account", /doesn't support/],
    ["teen_not_allowed", "SnapApp is for people 18 and over", /teen account/],
    ["teen_invite_required", "You need an invite from your parent", /parent or guardian/],
  ] as const;

  it.each(cases)("%s", async (refusal, title, body) => {
    cancelAction.mockResolvedValueOnce({
      kind: "redirect",
      redirectTo: "https://y.test/oidc/auth/b",
    });
    renderScreen(details({ screen: "refused", sharing: null, refusal }));
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to SnapApp" }));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith("https://y.test/oidc/auth/b"));
    expect(cancelAction).toHaveBeenCalledWith("uid_123-abc");
  });
});

describe("ended and unavailable", () => {
  it("a gone or foreign sign-in is a plain page with no way to continue", () => {
    renderEn(<ConnectEndedView />);
    expect(
      screen.getByRole("heading", { level: 1, name: "This sign-in has ended" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Go back to the app and try again.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("an unreachable API offers a retry, which reloads", async () => {
    renderEn(<ConnectUnavailableView />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("Indonesian", () => {
  it("renders the consent screen from the id-ID catalogue", () => {
    renderScreen(details(), "id-ID");
    expect(
      screen.getByRole("heading", { level: 1, name: "Lanjutkan ke SnapApp sebagai Ana" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanjutkan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Batal" })).toBeInTheDocument();
    expect(screen.getByText("Kamu akan kembali ke snap-apps.gaiada.com.")).toBeInTheDocument();
  });
});
