/**
 * Intake: assets in, drafts in.
 *
 * One implementation, two doors (session and token). Everything that decides whether a file or a caption
 * is acceptable lives here, so the agent path cannot quietly drift into being more permissive than the
 * UI — that is the failure mode a second implementation always produces.
 *
 * No native image library survives in `workerd` (ADR-013), so dimensions are read from the file headers
 * directly. If a format's header is not understood, the dimensions are null and the aspect-ratio warning
 * is skipped rather than guessed.
 */
import { and, eq, sql } from "drizzle-orm";

import { createDb, type Bindings } from "@/db/client";
import * as s from "@/db/schema";
import type { WorkspaceContext } from "@/lib/context";
import { specVersionFor, validate } from "@/lib/specs/validate";

/** 25 MB. A product limit, not a technical one: signed uploads arrive in M6. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/quicktime"];

export interface UploadInput {
  bytes: ArrayBuffer;
  filename: string;
  postable?: boolean;
}

export interface DraftTarget {
  channelId?: string;
  /** Resolved against the token's brand: a caller knows "tiktok", not an internal channel id. */
  platform?: string;
  caption: string;
  hashtags: string[];
  mediaIds: string[];
}

export interface DraftPayload {
  title: string;
  format: string;
  pillar?: string | null;
  targets: DraftTarget[];
}

export function intake(env: Bindings) {
  const db = createDb(env.DB);

  return {
    /**
     * Store one asset. Hash first, so a retry that re-sends identical bytes is a lookup, not another
     * object — and so the key is content-addressed from the start.
     */
    async upload(ctx: WorkspaceContext, input: UploadInput) {
      const bytes = new Uint8Array(input.bytes);

      if (bytes.byteLength === 0) return { ok: false as const, code: "empty_file" };
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return {
          ok: false as const,
          code: "too_large",
          message: `${Math.round(bytes.byteLength / (1024 * 1024))} MB, the limit is 25 MB`,
        };
      }

      const sniffed = sniff(bytes);
      if (!sniffed) {
        return {
          ok: false as const,
          code: "unsupported_type",
          message: `${input.filename}: not a supported image or video (PNG, JPEG, WebP, GIF, MP4, MOV)`,
        };
      }
      // Refused by policy, with the reason: SVG is a script container, and no target platform accepts it
      // as a photo. Saying "not accepted" would invite the question "why not, it is an image?".
      if (sniffed.mime === "image/svg+xml") {
        return {
          ok: false as const,
          code: "unsupported_type",
          message: `${input.filename}: SVG can carry script and is not accepted as a photo — export a PNG or JPEG`,
        };
      }
      if (!ACCEPTED.includes(sniffed.mime)) {
        return { ok: false as const, code: "unsupported_type", message: `${sniffed.mime} is not accepted` };
      }

      const hash = await hex(await crypto.subtle.digest("SHA-256", bytes));

      const [existing] = await db
        .select()
        .from(s.media)
        .where(and(eq(s.media.workspaceId, ctx.workspaceId), eq(s.media.hash, hash)))
        .limit(1);
      if (existing) return { ok: true as const, media: existing, deduplicated: true };

      const key = `media/${ctx.workspaceId}/${hash}.${extension(sniffed.mime)}`;
      const dims = dimensions(bytes, sniffed.mime);

      if (!env.MEDIA) {
        return { ok: false as const, code: "no_storage_binding", message: "R2 binding MEDIA is missing" };
      }
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: sniffed.mime } });

      const row = {
        id: `med_${hash.slice(0, 12)}`,
        workspaceId: ctx.workspaceId,
        hash,
        key,
        mime: sniffed.mime,
        bytes: bytes.byteLength,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        postable: input.postable ?? true,
        createdAt: Date.now(),
      };
      await db.insert(s.media).values(row);

      return { ok: true as const, media: row, deduplicated: false };
    },

    /**
     * Create a post with its variants, validated at the door.
     *
     * A blocked caption still creates the post — losing the asset and the caller's intent would be worse
     * than a card with a visible objection. The verdict comes back in the response so the caller can fix
     * it in the same session.
     */
    async createDraft(ctx: WorkspaceContext, brandId: string, payload: DraftPayload) {
      const now = Date.now();
      const postId = `post_${slug(payload.title)}_${now.toString(36)}`;

      await db.insert(s.posts).values({
        id: postId,
        workspaceId: ctx.workspaceId,
        brandId,
        title: payload.title,
        format: payload.format,
        pillar: payload.pillar ?? null,
        status: "review",
        createdAt: now,
        updatedAt: now,
      });

      const results: {
        channelId: string;
        platform: string;
        variantId: string | null;
        specState: string;
        issues: unknown;
        counted: number;
        error?: string;
      }[] = [];

      for (const target of payload.targets) {
        const [channel] = await db
          .select({ id: s.channels.id, platform: s.channels.platform, status: s.channels.status })
          .from(s.channels)
          .innerJoin(s.brands, eq(s.channels.brandId, s.brands.id))
          .where(
            and(
              eq(s.brands.workspaceId, ctx.workspaceId),
              eq(s.channels.brandId, brandId),
              target.channelId
                ? eq(s.channels.id, target.channelId)
                : sql`${s.channels.platform} = ${target.platform ?? ""}`,
            ),
          )
          // an active channel wins over a disconnected one when both exist for a platform
          .orderBy(sql`case when ${s.channels.status} = 'active' then 0 else 1 end`)
          .limit(1);

        if (!channel) {
          results.push({
            channelId: target.channelId ?? target.platform ?? "?",
            platform: "unknown",
            variantId: null,
            specState: "blocked",
            issues: [],
            counted: 0,
            error: "channel not found for this brand",
          });
          continue;
        }

        const facts = target.mediaIds.length
          ? await db
              .select()
              .from(s.media)
              .where(and(eq(s.media.workspaceId, ctx.workspaceId), eq(s.media.postable, true)))
          : [];
        const byId = new Map(facts.map((row) => [row.id, row]));
        const attached = target.mediaIds.map((id) => byId.get(id)).filter(Boolean);

        const verdict = validate(channel.platform, {
          caption: target.caption,
          hashtags: target.hashtags,
          media: attached.map((row) => ({
            bytes: Number(row!.bytes),
            width: row!.width ?? null,
            height: row!.height ?? null,
            mime: row!.mime,
            postable: Boolean(row!.postable),
          })),
        });

        const variantId = `var_${crypto.randomUUID().slice(0, 8)}`;
        await db.insert(s.variants).values({
          id: variantId,
          postId,
          channelId: channel.id,
          caption: target.caption,
          hashtags: JSON.stringify(target.hashtags),
          mediaIds: JSON.stringify(target.mediaIds),
          specState: verdict.state,
          specVersion: specVersionFor(channel.platform),
          createdAt: now,
          updatedAt: now,
        });

        results.push({
          channelId: channel.id,
          platform: channel.platform,
          variantId,
          specState: verdict.state,
          issues: verdict.issues,
          counted: verdict.count.counted,
        });
      }

      await db.insert(s.activityLog).values({
        id: `act_${crypto.randomUUID().slice(0, 8)}`,
        workspaceId: ctx.workspaceId,
        postId,
        actorId: ctx.userId,
        action: "draft.ingested",
        detail: JSON.stringify({
          targets: results.length,
          blocked: results.filter((row) => row.specState === "blocked").length,
        }),
        createdAt: now,
      });

      return { postId, status: "review" as const, targets: results };
    },

    /** Unattached, publishable assets — an upload that arrived before its post is not lost. */
    async listAttachable(ctx: WorkspaceContext) {
      const rows = await db
        .select()
        .from(s.media)
        .where(and(eq(s.media.workspaceId, ctx.workspaceId), eq(s.media.postable, true)));
      const used = await db.select({ mediaIds: s.variants.mediaIds }).from(s.variants);
      const referenced = new Set<string>();
      for (const row of used) {
        try {
          for (const id of JSON.parse(row.mediaIds ?? "[]") as string[]) referenced.add(id);
        } catch {
          /* a corrupt row must not break the list */
        }
      }
      return rows.filter((row) => !referenced.has(row.id));
    },
  };
}

/** Magic bytes, not extensions: a renamed executable is not a photo. */
export function sniff(bytes: Uint8Array): { mime: string } | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg" };
  if (b.length >= 6 && ascii(b, 0, 4) === "GIF8") return { mime: "image/gif" };
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return { mime: "image/webp" };
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    return { mime: brand === "qt  " ? "video/quicktime" : "video/mp4" };
  }
  // SVG is refused by policy: it can carry script, and no target platform accepts it as a photo.
  if (b.length >= 5 && ascii(b, 0, 4).toLowerCase() === "<svg") return { mime: "image/svg+xml" };
  return null;
}

function dimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && bytes.length > 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (mime === "image/gif" && bytes.length > 10) {
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    if (mime === "image/jpeg") {
      // walk the segments to the first Start-Of-Frame marker
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        const marker = bytes[offset + 1];
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          return { width, height };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function extension(mime: string): string {
  return mime.split("/")[1].replace("quicktime", "mov").replace("jpeg", "jpg");
}

async function hex(buffer: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
