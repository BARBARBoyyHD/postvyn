/**
 * Intake: drafts in.
 *
 * Assets arrive separately now — an upload is a minted URL, bytes straight to R2, and a row written
 * afterwards (`src/db/media-upload.ts`, m6 1.1–1.8). What is left here is the other half of the door:
 * turn a caption plus media ids into a post with variants, validated by the spec engine at the moment
 * it lands.
 *
 * One implementation for two doors (session and token), so the agent path cannot quietly drift into
 * being more permissive than the UI — the failure mode a second implementation always produces.
 */
import { and, eq, sql } from "drizzle-orm";

import { createDb, type Bindings } from "@/db/client";
import * as s from "@/db/schema";
import type { WorkspaceContext } from "@/lib/context";
import { specVersionFor, validate } from "@/lib/specs/validate";

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
          title: payload.title,
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

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
