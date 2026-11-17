/**
 * OAuth 1.0a request signing for X, in TypeScript over WebCrypto.
 *
 * X's user context is four stored values — API key and secret, access token and secret — and every
 * request carries a signature over the method, the URL and *every* parameter the platform will read,
 * query string included (`docs/005-REQUIREMENTS.md` §5 lists the four names).
 *
 * Three things here are famously fiddly, so they are written once, in the order RFC 5849 §3.4 says:
 *
 *  1. **Percent-encoding** is the RFC 3986 unreserved set only: `encodeURIComponent` leaves `!*'()`
 *     alone, and X/HMAC will disagree with you if you leave them alone too.
 *  2. **The parameter string** is every parameter — OAuth's, the query's, and any form-encoded body's
 *     — encoded, sorted by name then value, joined with `&`, and then encoded *again* as one string.
 *  3. **The base string** uses the URL *without* its query (the query is already in the parameters).
 *
 * HMAC-SHA1 comes from `crypto.subtle`: no native module, no dependency, and SHA-1 is only acceptable
 * here because OAuth 1.0a's signature method *is* HMAC-SHA1 — the protocol's choice, not ours.
 */
import type { HttpCall } from "./transport";

/** The four values an X channel stores. `docs/005-REQUIREMENTS.md` §5 names their X_DASHED twins. */
export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

export const X_CREDENTIAL_KEYS = ["apiKey", "apiSecret", "accessToken", "accessSecret"] as const;

export type CredentialLookup =
  | { ok: true; credentials: XCredentials }
  /** Names the missing fields: "reconnect this channel" is not a sentence an operator can act on. */
  | { ok: false; missing: string[] };

export function xCredentials(bag: Readonly<Record<string, string>>): CredentialLookup {
  const missing = X_CREDENTIAL_KEYS.filter((key) => !bag[key]);
  if (missing.length > 0) return { ok: false, missing: [...missing] };
  return {
    ok: true,
    credentials: {
      apiKey: bag.apiKey,
      apiSecret: bag.apiSecret,
      accessToken: bag.accessToken,
      accessSecret: bag.accessSecret,
    },
  };
}

const SIGNATURE_METHOD = "HMAC-SHA1";
const OAUTH_VERSION = "1.0";
const NONCE_BYTES = 16;

export interface SigningRequest {
  method: HttpCall["method"];
  /** Any query string on this URL is signed; the base string uses the URL without it. */
  url: string;
  credentials: XCredentials;
  /** Form-encoded body parameters. X's JSON calls have none — a JSON body is not signed. */
  bodyParams?: ReadonlyArray<readonly [string, string]>;
  /** Injected by a test so a signature is reproducible; production takes a fresh nonce. */
  nonce?: string;
  /** Unix seconds, injected by a test for the same reason. */
  timestamp?: number;
}

/** The authorization header for one request: a fresh nonce every time, or X sees a replay. */
export async function oauth1Header(request: SigningRequest): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: request.credentials.apiKey,
    oauth_nonce: request.nonce ?? nonce(),
    oauth_signature_method: SIGNATURE_METHOD,
    oauth_timestamp: String(request.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: request.credentials.accessToken,
    oauth_version: OAUTH_VERSION,
  };

  // Every parameter the platform reads is signed — the query string and a form-encoded body too —
  // but only the `oauth_*` ones travel in the header (RFC 5849 §3.5.1). Sending `file=vacation.jpg`
  // back in an Authorization header would be a second, conflicting copy of the request.
  const signing: Record<string, string> = { ...oauth };
  for (const [name, value] of request.bodyParams ?? []) signing[name] = value;
  for (const [name, value] of new URL(request.url).searchParams) signing[name] = value;

  oauth.oauth_signature = await hmacSha1Base64(
    signingKey(request.credentials),
    oauthBaseString(request.method, request.url, signing),
  );

  const header = Object.keys(oauth)
    .sort()
    .map((name) => `${percentEncode(name)}="${percentEncode(oauth[name])}"`)
    .join(", ");
  return `OAuth ${header}`;
}

/**
 * The signature base string (RFC 5849 §3.4.1). Exported because it is the part worth asserting:
 * a signature that happens to match hides an encoding error in both halves.
 */
export function oauthBaseString(
  method: string,
  url: string,
  parameters: Readonly<Record<string, string>>,
): string {
  const query = url.indexOf("?");
  const baseUri = query === -1 ? url : url.slice(0, query);
  const encoded = Object.entries(parameters)
    .map(([name, value]) => `${percentEncode(name)}=${percentEncode(value)}`)
    .sort()
    .join("&");
  return `${method.toUpperCase()}&${percentEncode(baseUri)}&${percentEncode(encoded)}`;
}

/** A request carrying a signature — the only shape this package sends to X. */
export async function signedCall(
  credentials: XCredentials,
  call: {
    method: HttpCall["method"];
    url: string;
    headers?: Record<string, string>;
    body?: string;
    bodyBytes?: Uint8Array<ArrayBuffer>;
  },
): Promise<HttpCall> {
  return {
    ...call,
    headers: { ...call.headers, authorization: await oauth1Header({ ...call, credentials }) },
  };
}

/** RFC 3986 §2.3 unreserved, and nothing else. `encodeURIComponent` is a superset by four characters. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function signingKey(credentials: XCredentials): string {
  return `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessSecret)}`;
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return toBase64(new Uint8Array(mac));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
