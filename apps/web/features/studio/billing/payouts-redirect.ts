/**
 * A 303 to a path on this site. Relative on purpose: a Location built from
 * the request's (forwarded) host would let a forged Host header redirect
 * the browser elsewhere.
 */
export function seeOther(path: `/${string}`): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}

/** A 303 to the processor's page, which the API chose. */
export function seeOtherExternal(url: string): Response {
  return new Response(null, { status: 303, headers: { location: url } });
}
