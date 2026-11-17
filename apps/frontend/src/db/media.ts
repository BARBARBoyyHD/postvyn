/**
 * A variant's media ids, turned into URLs a platform can fetch.
 *
 * Meta downloads the bytes itself, so the only thing an adapter may send is a public URL: R2 object
 * key under `R2_PUBLIC_BASE` (design.md, "Instagram requires a public media URL"). Two rows cannot
 * produce one, and both are refused by name rather than guessed at — a guessed URL is a post that
 * fails somewhere the operator cannot see:
 *
 *  - `R2_PUBLIC_BASE` is empty, so nothing is public;
 *  - the row still points at a vault path instead of an R2 key (an import from v0.1). M6 migrates
 *    those rows; until then the refusal says which one, because "media not found" would not.
 */
import { and, eq, inArray } from "drizzle-orm";

import { createDb, type Bindings } from "./client";
import * as s from "./schema";
import type { WorkspaceContext } from "@/lib/context";
import type { PublishMedia } from "@/publishers/port";

/** Intake writes `media/<workspace>/<hash>.<ext>`; anything else is a path R2 does not serve. */
const R2_KEY_PREFIX = "media/";

export type MediaRefusal =
  | { ok: false; reason: "base_missing"; message: string }
  | { ok: false; reason: "media_missing"; mediaId: string; message: string }
  | { ok: false; reason: "not_postable"; mediaId: string; message: string }
  | { ok: false; reason: "no_object_key"; mediaId: string; message: string };

export type MediaResolution = { ok: true; media: PublishMedia[] } | MediaRefusal;

export function mediaResolver(env: Bindings & { R2_PUBLIC_BASE?: string }) {
  const db = createDb(env.DB);

  return {
    /** In the variant's order: a reordered carousel is different content (m4 decision 1). */
    async resolve(ctx: WorkspaceContext, mediaIds: readonly string[]): Promise<MediaResolution> {
      if (mediaIds.length === 0) return { ok: true, media: [] };

      const base = env.R2_PUBLIC_BASE?.trim().replace(/\/+$/, "") ?? "";
      if (!base) {
        return {
          ok: false,
          reason: "base_missing",
          message:
            "R2_PUBLIC_BASE is empty, so no media URL can be built. Meta fetches the bytes from a " +
            "public URL; set the variable (wrangler.jsonc vars) before publishing.",
        };
      }

      const rows = await db
        .select()
        .from(s.media)
        .where(and(eq(s.media.workspaceId, ctx.workspaceId), inArray(s.media.id, [...mediaIds])));

      const byId = new Map(rows.map((row) => [row.id, row]));
      const media: PublishMedia[] = [];

      for (const id of mediaIds) {
        const row = byId.get(id);
        if (!row) {
          return {
            ok: false,
            reason: "media_missing",
            mediaId: id,
            message: `media ${id} is not in this workspace`,
          };
        }
        if (!row.postable) {
          return {
            ok: false,
            reason: "not_postable",
            mediaId: id,
            message: `media ${id} is reference material (postable = 0) and must never ship`,
          };
        }
        if (!row.key.startsWith(R2_KEY_PREFIX)) {
          return {
            ok: false,
            reason: "no_object_key",
            mediaId: id,
            message: `media ${id} has no R2 key (${row.key}); it still points at a vault path from the import`,
          };
        }

        media.push({
          id,
          url: `${base}/${row.key}`,
          kind: row.mime.startsWith("video/") ? "video" : "image",
        });
      }

      return { ok: true, media };
    },
  };
}
