import { loginAction } from "@/lib/api/actions";

/**
 * `/dev/login` (1.7.e's Check harness) — exercises the real `loginAction`
 * (1.7.b) end to end: a plain HTML form, zero client JS, posting straight
 * to the Server Action that calls `POST /api/auth/login`, then
 * `GET /api/me`, then sets the `yt_session`/`yt_region`/`yt_locale`
 * cookies. Not the shipped sign-in page — that is B's `(auth)` route
 * (6.2.a), not built yet — same "plain, reviewer's tool" convention as
 * `/dev/inbox` (1.6.b).
 */
export default async function DevLoginPage(props: PageProps<"/dev/login">) {
  const searchParams = await props.searchParams;
  const returnToParam = searchParams["returnTo"];
  const returnToRaw = Array.isArray(returnToParam) ? returnToParam[0] : returnToParam;
  const returnTo = returnToRaw?.startsWith("/") === true ? returnToRaw : "/dev/whoami";

  return (
    <main style={{ padding: "1.5rem", fontFamily: "monospace", maxWidth: "30rem" }}>
      <h1>Dev login</h1>
      <p>Exercises the real loginAction (1.7.b) — not a shipped page.</p>
      <form
        action={loginAction}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <input type="hidden" name="returnTo" value={returnTo} />
        <label>
          Email
          <input name="email" type="email" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
