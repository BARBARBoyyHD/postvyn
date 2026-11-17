/**
 * The upload path: mint a signed URL, then record what actually landed.
 *
 * Bytes never pass through the Worker (design decision 1), so this module's job is the two halves that
 * do: `mint()` writes nothing and answers a URL scoped to one key, one content type and one expiry;
 * `record()` believes none of the client's claims and re-reads the object from R2 before writing a row.
 *
 * Recording is also where a file becomes *storable* in the sense the product means:
 *
 *  - the type is sniffed from the bytes, and a declared type that disagrees is refused, not averaged;
 *  - metadata is stripped, and the hash is taken over the stripped bytes, so dedupe reflects what is
 *    actually served rather than what was uploaded;
 *  - the object is written to a content-addressed key and read back, so the row can only describe a
 *    file that is really there.
 *
 * An object with no row is invisible: nothing else in the app lists or serves a bare key.
 */
import { and, eq } from "drizzle-orm";

import { createDb } from "./client";
import * as s from "./schema";
import { objectKey, publicMediaUrl } from "@/lib/media/address";
import {
  MAX_UPLOAD_BYTES,
  SVG_MIME,
  dimensions,
  extensionFor,
  isAcceptedMime,
  sha256Hex,
  sniff,
  stripMetadata,
  type MediaMime,
} from "@/lib/media/bytes";
import { UPLOAD_URL_TTL_SECONDS, presignPut } from "@/lib/media/r2-presign";
import type { UploadRefusal } from "@/lib/media/upload";
import type { WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";

export interface MintInput {
  filename: string;
  /** The client's claim. It picks the key's extension and is verified again at record time. */
  mime: string;
  /** The size the client says it will upload — the ceiling is checked before a URL exists. */
  bytes: number;
}

export type MintedUpload =
  | {
      ok: true;
      /** What `POST /api/v1/media/:id/record` takes as `:id`. */
      uploadId: string;
      key: string;
      url: string;
      mime: MediaMime;
      maxBytes: number;
      expiresAt: number;
    }
  | UploadRefusal;

export interface RecordInput {
  mime: string;
  /** What the client believes the file measures. Compared, never stored — the header wins. */
  width?: number | null;
  height?: number | null;
  postable?: boolean;
}

export type RecordedMedia =
  | { ok: true; media: s.Media; url: string | null; deduplicated: boolean }
  | UploadRefusal;

interface StorageConfig {
  bucket: R2Bucket;
  endpoint: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function uploadStore(env: WorkerEnv) {
  const db = createDb(env.DB);

  async function mint(ctx: WorkspaceContext, input: MintInput): Promise<MintedUpload> {
    const declared = input.mime.trim().toLowerCase();
    if (declared === SVG_MIME) return deny("unsupported_type", svgReason(input.filename));
    if (!isAcceptedMime(declared)) return deny("unsupported_type", unsupportedReason(input.filename, declared));
    if (input.bytes <= 0) return deny("empty_file", `${input.filename}: nothing to upload`);
    if (input.bytes > MAX_UPLOAD_BYTES) return deny("too_large", tooLarge(input.bytes));

    const storage = storageFor(env);
    if (!storage.ok) return storage;

    const uploadId = `upl_${crypto.randomUUID().slice(0, 12)}`;
    const key = uploadKey(ctx.workspaceId, uploadId, declared);
    const now = Date.now();
    const url = await presignPut({
      endpoint: storage.endpoint,
      bucket: storage.bucketName,
      key,
      contentType: declared,
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
      now,
    });

    return {
      ok: true,
      uploadId,
      key,
      url,
      mime: declared,
      maxBytes: MAX_UPLOAD_BYTES,
      expiresAt: now + UPLOAD_URL_TTL_SECONDS * 1000,
    };
  }

  async function record(
    ctx: WorkspaceContext,
    uploadId: string,
    input: RecordInput,
  ): Promise<RecordedMedia> {
    const declared = input.mime.trim().toLowerCase();
    if (declared === SVG_MIME) return deny("unsupported_type", svgReason(uploadId));
    if (!isAcceptedMime(declared)) return deny("unsupported_type", unsupportedReason(uploadId, declared));

    const storage = storageFor(env);
    if (!storage.ok) return storage;
    const { bucket } = storage;

    // The key is rebuilt from the workspace and the upload id, never taken from the request: a caller
    // cannot name an object in another workspace, or one of their own this door did not mint.
    const landing = uploadKey(ctx.workspaceId, uploadId, declared);
    const discard = async () => {
      await bucket.delete(landing);
    };

    const head = await bucket.head(landing);
    if (!head) {
      return deny("upload_missing", `no object at ${landing} — upload the bytes before recording them`);
    }
    // Re-checked here because a presigned PUT cannot cap the body: a client that ignored `maxBytes`
    // is refused now, and the object is removed rather than left to sit in the bucket.
    if (head.size > MAX_UPLOAD_BYTES) {
      await discard();
      return deny("too_large", tooLarge(head.size));
    }

    const object = await bucket.get(landing);
    if (!object) return deny("upload_missing", `no object at ${landing} — upload the bytes before recording them`);

    const prepared = await prepare(new Uint8Array(await object.arrayBuffer()), declared, input);
    if (!prepared.ok) {
      await discard();
      return prepared;
    }
    const { mime, stripped, measured, hash } = prepared;
    const key = `media/${ctx.workspaceId}/${hash}.${extensionFor(mime)}`;

    // The same bytes in this workspace are the same row (design decision 4). No second object is
    // written, and the URL the operator gets is the one already in use.
    const existing = await findExisting(ctx, hash);
    if (existing) {
      const stored = await serveableObject(bucket, existing, key, stripped, mime);
      await discard();
      return {
        ok: true,
        media: { ...existing, r2Key: stored },
        url: publicMediaUrl(env.R2_PUBLIC_BASE, stored),
        deduplicated: true,
      };
    }

    await store(bucket, key, stripped, mime);
    const row: s.Media = {
      // The hash names the object, but not the row: identical bytes in two workspaces are two rows
      // (spec: "Two workspaces do not share an object"), and a hash-only id would collide.
      id: `med_${hash.slice(0, 12)}_${crypto.randomUUID().slice(0, 6)}`,
      workspaceId: ctx.workspaceId,
      hash,
      key,
      r2Key: null,
      mime,
      bytes: stripped.byteLength,
      width: measured?.width ?? null,
      height: measured?.height ?? null,
      postable: input.postable ?? true,
      createdAt: Date.now(),
    };

    const [inserted] = await db.insert(s.media).values(row).onConflictDoNothing().returning();
    await discard();

    // `one_media_per_hash_per_workspace` refused it: a concurrent record of the same bytes got there
    // first, and its row is the identity — this request's job is to answer with that row.
    if (!inserted) {
      const winner = await findExisting(ctx, hash);
      if (!winner) throw new Error(`media row for ${hash} vanished between insert and read`);
      return { ok: true, media: winner, url: publicMediaUrl(env.R2_PUBLIC_BASE, objectKey(winner)), deduplicated: true };
    }

    return { ok: true, media: inserted, url: publicMediaUrl(env.R2_PUBLIC_BASE, objectKey(inserted)), deduplicated: false };
  }

  async function findExisting(ctx: WorkspaceContext, hash: string): Promise<s.Media | undefined> {
    const [row] = await db
      .select()
      .from(s.media)
      .where(and(eq(s.media.workspaceId, ctx.workspaceId), eq(s.media.hash, hash)))
      .limit(1);
    return row;
  }

  /**
   * The object a deduplicated row points at, storing it if the row has none yet.
   *
   * A row imported from the vault keeps a path in `key` (m6 2.4) and has no object: re-uploading the
   * same bytes is how that media becomes servable, without deleting the path the import is audited by.
   */
  async function serveableObject(
    bucket: R2Bucket,
    existing: s.Media,
    key: string,
    bytes: Uint8Array<ArrayBuffer>,
    mime: MediaMime,
  ): Promise<string> {
    const stored = objectKey(existing);
    if (stored) return stored;

    await store(bucket, key, bytes, mime);
    await db
      .update(s.media)
      .set({ r2Key: key })
      .where(and(eq(s.media.workspaceId, existing.workspaceId), eq(s.media.id, existing.id)));
    return key;
  }

  return { mint, record };
}

/** `media/<workspace>/<uploadId>.<ext>` — the landing key, replaced by a content-addressed one on record. */
function uploadKey(workspaceId: string, uploadId: string, mime: MediaMime): string {
  return `media/${workspaceId}/${uploadId}.${extensionFor(mime)}`;
}

/**
 * Write the stripped bytes and read the size back.
 *
 * The read-back is the whole point of this function: a put that silently did not land would become a
 * row describing a 404 that Instagram discovers later, and a HEAD is the cheapest proof available
 * that the object at that key is the one just written (the stripped length, not the uploaded one).
 */
async function store(
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array<ArrayBuffer>,
  mime: MediaMime,
): Promise<void> {
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
  const landed = await bucket.head(key);
  if (!landed || landed.size !== bytes.byteLength) {
    throw new Error(`media ${key} did not store the stripped bytes (${bytes.byteLength} expected)`);
  }
}

function verifyBytes(bytes: Uint8Array, declared: string): { ok: true; mime: MediaMime } | UploadRefusal {
  if (bytes.byteLength === 0) return deny("empty_file", "the uploaded object is empty");
  const sniffed = sniff(bytes);
  if (!sniffed) return deny("unsupported_type", unsupportedReason("the object", declared));
  if (sniffed.mime === SVG_MIME) return deny("unsupported_type", svgReason("the object"));
  if (sniffed.mime !== declared) {
    return deny(
      "type_mismatch",
      `declared ${declared}, the bytes are ${sniffed.mime} — the type is read from the file, not from the name`,
    );
  }
  return { ok: true, mime: sniffed.mime };
}

interface PreparedBytes {
  ok: true;
  mime: MediaMime;
  /** The bytes that will be stored — metadata removed. */
  stripped: Uint8Array<ArrayBuffer>;
  measured: { width: number; height: number } | null;
  hash: string;
}

/**
 * Everything about the upload that the bytes decide: the type, the stripped form, the measurement and
 * the hash. The client's claims are inputs to refuse, never values to store.
 */
async function prepare(
  bytes: Uint8Array<ArrayBuffer>,
  declared: string,
  input: RecordInput,
): Promise<PreparedBytes | UploadRefusal> {
  const verified = verifyBytes(bytes, declared);
  if (!verified.ok) return verified;

  const stripped = stripMetadata(bytes, verified.mime);
  // A second pass must not shrink the file again: if it does, metadata survived the first strip and
  // would have been published. Cheap, because a strip is a segment walk and not a decode.
  if (stripMetadata(stripped, verified.mime).byteLength !== stripped.byteLength) {
    throw new Error(`metadata survived the strip (${verified.mime})`);
  }

  const measured = dimensions(stripped, verified.mime);
  if (input.width != null && input.height != null && measured) {
    if (input.width !== measured.width || input.height !== measured.height) {
      return deny(
        "dimensions_mismatch",
        `declared ${input.width}×${input.height}, the bytes are ${measured.width}×${measured.height}`,
      );
    }
  }

  return { ok: true, mime: verified.mime, stripped, measured, hash: await sha256Hex(stripped) };
}

function storageFor(env: WorkerEnv): ({ ok: true } & StorageConfig) | UploadRefusal {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const bucketName = env.R2_BUCKET?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();

  const missing = [
    !accountId && "R2_ACCOUNT_ID",
    !bucketName && "R2_BUCKET",
    !accessKeyId && "R2_ACCESS_KEY_ID",
    !secretAccessKey && "R2_SECRET_ACCESS_KEY",
    !env.MEDIA && "the MEDIA bucket binding",
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0 || !env.MEDIA || !accountId || !bucketName || !accessKeyId || !secretAccessKey) {
    return deny(
      "storage_unconfigured",
      `uploads cannot be signed or recorded: ${missing.join(", ")} missing. Set the R2 values in wrangler secrets before uploading.`,
    );
  }

  return {
    ok: true,
    bucket: env.MEDIA,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    bucketName,
    accessKeyId,
    secretAccessKey,
  };
}

function deny(code: UploadRefusal["code"], message: string): UploadRefusal {
  return { ok: false, code, message };
}

function tooLarge(bytes: number): string {
  const limit = MAX_UPLOAD_BYTES / (1024 * 1024);
  return `${Math.round(bytes / (1024 * 1024))} MB, the limit is ${limit} MB`;
}

function unsupportedReason(filename: string, declared: string): string {
  return `${filename}: ${declared} is not supported — PNG, JPEG, WebP, GIF, MP4 or MOV only`;
}

/** Refused by policy, with the reason: "not accepted" would invite the question "why not, it is an image?". */
function svgReason(filename: string): string {
  return `${filename}: SVG can carry script and no platform accepts it as a photo — export a PNG or JPEG`;
}
