/**
 * A short-lived PUT URL for one object, signed with R2's S3 endpoint (SigV4 query signing).
 *
 * The Worker mints and records; the bytes go from the browser to the bucket. That is not an
 * optimisation — a 25 MB upload through a Worker with a millisecond CPU budget is a failed upload
 * (design decision 1). R2's binding cannot presign, so this signs against the S3 API with WebCrypto:
 * no `aws-sdk`, no native crypto.
 *
 * Three properties the URL has, by construction, and which a test asserts:
 *
 *  - it expires (`X-Amz-Expires`), so a leaked URL is stale by the time anyone finds it;
 *  - it names exactly one key and one method — changing either breaks the signature;
 *  - `content-type` is a *signed* header, so a URL minted for a PNG cannot be used to store something
 *    declared as a video. The record step re-sniffs the bytes anyway; this stops the wrong bytes from
 *    landing under a name that lies about them.
 */

/**
 * Ten minutes. Long enough for a phone photo on hotel wifi, short enough that the window between a
 * stolen URL and its expiry is not a working day.
 */
export const UPLOAD_URL_TTL_SECONDS = 600;

/** R2's S3 endpoint is region `auto`; SigV4 still needs the words, so they are named once. */
const REGION = "auto";
const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";

export interface PresignPutInput {
  /** `https://<account-id>.r2.cloudflarestorage.com` — `R2_ACCOUNT_ID` in the environment. */
  endpoint: string;
  bucket: string;
  key: string;
  /** Signed, so the client must send exactly this value on the PUT. */
  contentType: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Injected so a signature is reproducible; production passes `Date.now()`. */
  now: number;
  expiresSeconds?: number;
}

export async function presignPut(input: PresignPutInput): Promise<string> {
  const endpoint = new URL(input.endpoint);
  const expires = input.expiresSeconds ?? UPLOAD_URL_TTL_SECONDS;
  const amzDate = new Date(input.now).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  const canonicalPath = `/${[input.bucket, ...input.key.split("/")].map(encodeRfc3986).join("/")}`;
  // Query parameters are in the order SigV4 sorts them: the name is the sort key.
  const query = [
    `X-Amz-Algorithm=${ALGORITHM}`,
    `X-Amz-Credential=${encodeRfc3986(`${input.accessKeyId}/${scope}`)}`,
    `X-Amz-Date=${amzDate}`,
    `X-Amz-Expires=${expires}`,
    `X-Amz-SignedHeaders=${encodeRfc3986("content-type;host")}`,
  ].join("&");

  // The canonical request is what the signature covers: any difference — the key, the type, the
  // expiry — produces a different signature, and the bucket refuses the request.
  const canonicalRequest = [
    "PUT",
    canonicalPath,
    query,
    `content-type:${input.contentType}\nhost:${endpoint.host}\n`,
    "content-type;host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  let signingKey = await hmacSha256(text(`AWS4${input.secretAccessKey}`), dateStamp);
  signingKey = await hmacSha256(signingKey, REGION);
  signingKey = await hmacSha256(signingKey, SERVICE);
  signingKey = await hmacSha256(signingKey, "aws4_request");
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  return `${endpoint.origin}${canonicalPath}?${query}&X-Amz-Signature=${signature}`;
}

/** RFC 3986 §2.3 unreserved, and nothing else: `encodeURIComponent` leaves `!*'()` unescaped. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function hmacSha256(
  keyBytes: Uint8Array<ArrayBuffer>,
  message: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, text(message)));
}

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", text(message));
  return toHex(new Uint8Array(digest));
}

function text(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
