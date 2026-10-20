import type { ErrorOut, KoaContextWithOIDC } from "oidc-provider";

/**
 * The page the provider shows for an error it cannot send back to an app:
 * an unknown client, a redirect URI that does not match exactly, and the
 * like (docs/26 §1.7). Never a redirect, so YourTal cannot be an open
 * redirect. Plain, self-contained HTML; every value from the request is escaped.
 */
const COPY = {
  "en-AU": {
    title: "This sign-in link doesn't work",
    body: "The app that sent you here asked YourTal to sign you in in a way YourTal can't accept, so nothing happened and nothing was shared. Go back to the app and try again.",
    code: "Error code",
  },
  "id-ID": {
    title: "Tautan masuk ini tidak berfungsi",
    body: "Aplikasi yang mengarahkan Anda ke sini meminta YourTal memasukkan Anda dengan cara yang tidak dapat diterima YourTal, jadi tidak ada yang terjadi dan tidak ada yang dibagikan. Kembali ke aplikasi dan coba lagi.",
    code: "Kode kesalahan",
  },
} as const;

type Locale = keyof typeof COPY;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The app's `ui_locales` first, then the browser's language; English by default. */
export function errorPageLocale(uiLocales: unknown, acceptLanguage: string | undefined): Locale {
  const wanted = [
    ...(typeof uiLocales === "string" ? uiLocales.split(" ") : []),
    ...(acceptLanguage ?? "").split(",").map((part) => part.split(";")[0]?.trim() ?? ""),
  ];
  for (const tag of wanted) {
    const lower = tag.toLowerCase();
    if (lower.startsWith("id")) return "id-ID";
    if (lower.startsWith("en")) return "en-AU";
  }
  return "en-AU";
}

export function errorPage(locale: Locale, errorCode: string): string {
  const copy = COPY[locale];
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(copy.title)} · YourTal</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f5f2;color:#1c1b19}
main{max-width:30rem;margin:12vh auto;padding:0 1rem}
h1{font-size:1.4rem;line-height:1.3}
p{line-height:1.5}
small{color:#5c5a55}
@media (prefers-color-scheme:dark){body{background:#151412;color:#f1efe9}small{color:#a7a49c}}
</style>
</head>
<body>
<main>
<p><strong>YourTal</strong></p>
<h1>${escapeHtml(copy.title)}</h1>
<p>${escapeHtml(copy.body)}</p>
<p><small>${escapeHtml(copy.code)}: ${escapeHtml(errorCode)}</small></p>
</main>
</body>
</html>`;
}

/** Typed as always there, but an error raised before the request is parsed has no params yet. */
function requestedLocales(ctx: KoaContextWithOIDC): unknown {
  try {
    return ctx.oidc.params?.["ui_locales"];
  } catch {
    return undefined;
  }
}

export function renderError(ctx: KoaContextWithOIDC, out: ErrorOut): void {
  const locale = errorPageLocale(requestedLocales(ctx), ctx.get("accept-language"));
  ctx.type = "html";
  ctx.set("cache-control", "no-store");
  ctx.set(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  );
  ctx.body = errorPage(locale, out.error);
}
