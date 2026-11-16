/**
 * The composer's write model.
 *
 * Separate from `repository.ts` because it has a different job: the repository answers questions, this
 * one changes rows and, in the same call, re-decides whether the row still satisfies its platform. A
 * variant whose caption changed is a variant whose verdict is stale, so the two writes are one.
 *
 * Every method takes a `WorkspaceContext` — the tenancy chokepoint is not bypassed by a new module.
 */
import { and, eq, inArray } from "drizzle-orm";

import { createDb, type Bindings } from "./client";
import * as s from "./schema";
import type { WorkspaceContext } from "@/lib/context";
import { requireCtx } from "./repository";
import { specVersionFor, validate, type MediaFacts } from "@/lib/specs/validate";

export interface PostDraft {
  title: string;
  format: string;
  pillar: string | null;
}

export interface VariantDraft {
  caption: string;
  hashtags: string[];
  mediaIds: string[];
}

export function composer(env: Bindings) {
  const db = createDb(env.DB);

  /** `activity_log` lives here too, so an override and its cause sit in one history. */
  async function log(ctx: WorkspaceContext, postId: string | null, action: string, detail: unknown) {
    await db.insert(s.activityLog).values({
      id: `act_${crypto.randomUUID().slice(0, 8)}`,
      workspaceId: ctx.workspaceId,
      postId,
      actorId: ctx.userId,
      action,
      detail: JSON.stringify(detail ?? {}),
      createdAt: Date.now(),
    });
  }

  /** Media facts for validation, read in one query for the ids a variant references. */
  async function mediaFacts(ctx: WorkspaceContext, ids: string[]): Promise<Map<string, MediaFacts>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select()
      .from(s.media)
      .where(and(eq(s.media.workspaceId, ctx.workspaceId), inArray(s.media.id, ids)));
    return new Map(
      rows.map((row) => [
        row.id,
        {
          bytes: Number(row.bytes),
          width: row.width ?? null,
          height: row.height ?? null,
          mime: row.mime,
          postable: Boolean(row.postable),
        },
      ]),
    );
  }

  async function platformFor(ctx: WorkspaceContext, channelId: string): Promise<string | null> {
    // `channels` hangs off a brand, not a workspace — the tenant scope comes through the join.
    const [row] = await db
      .select({ platform: s.channels.platform })
      .from(s.channels)
      .innerJoin(s.brands, eq(s.channels.brandId, s.brands.id))
      .where(and(eq(s.brands.workspaceId, ctx.workspaceId), eq(s.channels.id, channelId)))
      .limit(1);
    return row?.platform ?? null;
  }

  return {
    /** A new post starts in `drafting`: intent is recorded before content exists. */
    async createPost(ctx: WorkspaceContext, brandId: string, draft: PostDraft) {
      const c = requireCtx(ctx);
      const now = Date.now();
      const id = `post_${slugify(draft.title)}_${now.toString(36)}`;

      await db.insert(s.posts).values({
        id,
        workspaceId: c.workspaceId,
        brandId,
        title: draft.title,
        format: draft.format,
        pillar: draft.pillar,
        status: "drafting",
        createdAt: now,
        updatedAt: now,
      });

      await log(c, id, "post_created", { title: draft.title, format: draft.format });
      return id;
    },

    async updatePost(ctx: WorkspaceContext, postId: string, patch: Partial<PostDraft>) {
      const c = requireCtx(ctx);
      const [existing] = await db
        .select()
        .from(s.posts)
        .where(and(eq(s.posts.workspaceId, c.workspaceId), eq(s.posts.id, postId)))
        .limit(1);
      if (!existing) return null;

      await db
        .update(s.posts)
        .set({
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.format !== undefined ? { format: patch.format } : {}),
          ...(patch.pillar !== undefined ? { pillar: patch.pillar } : {}),
          updatedAt: Date.now(),
        })
        .where(and(eq(s.posts.workspaceId, c.workspaceId), eq(s.posts.id, postId)));

      await log(c, postId, "post_updated", patch);
      return postId;
    },

    /** One variant per channel: a second would be the same post published twice to one account. */
    async createVariant(ctx: WorkspaceContext, postId: string, channelId: string) {
      const c = requireCtx(ctx);
      const platform = await platformFor(c, channelId);
      if (!platform) redirect_unknown_channel();

      const [existing] = await db
        .select({ id: s.variants.id })
        .from(s.variants)
        .where(and(eq(s.variants.postId, postId), eq(s.variants.channelId, channelId)))
        .limit(1);
      if (existing) return { id: existing.id, created: false as const };

      const id = `var_${crypto.randomUUID().slice(0, 8)}`;
      const verdict = validate(platform, { caption: "", hashtags: [], media: [] });

      await db.insert(s.variants).values({
        id,
        postId,
        channelId,
        caption: "",
        hashtags: "[]",
        mediaIds: "[]",
        specState: verdict.state,
        specVersion: specVersionFor(platform),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await log(c, postId, "variant_added", { channelId, platform });
      return { id, created: true as const };
    },

    /**
     * Write the content and its verdict together.
     *
     * The verdict is computed from what is about to be stored, not from what was there — otherwise a
     * variant keeps an `ok` it earned three edits ago.
     */
    async updateVariant(
      ctx: WorkspaceContext,
      variantId: string,
      draft: VariantDraft,
      options: { revision?: number } = {},
    ) {
      const c = requireCtx(ctx);

      const [variant] = await db
        .select()
        .from(s.variants)
        .where(eq(s.variants.id, variantId))
        .limit(1);
      if (!variant) return null;

      // the variant's post carries the workspace; check it here rather than trusting the id alone
      const [post] = await db
        .select({ id: s.posts.id, workspaceId: s.posts.workspaceId, status: s.posts.status })
        .from(s.posts)
        .where(eq(s.posts.id, variant.postId))
        .limit(1);
      if (!post || post.workspaceId !== c.workspaceId) return null;

      const platform = await platformFor(c, variant.channelId);
      if (!platform) return null;

      // A write older than what is stored means a slower request arrived late. Applying it would
      // silently undo whatever the operator typed in between.
      if (options.revision !== undefined && options.revision < (variant.revision ?? 0)) {
        return { stale: true as const, storedRevision: variant.revision ?? 0 };
      }

      const facts = await mediaFacts(c, draft.mediaIds);
      const verdict = validate(platform, {
        caption: draft.caption,
        hashtags: draft.hashtags,
        media: [...facts.values()],
      });

      const nextRevision = Math.max(options.revision ?? 0, variant.revision ?? 0) + 1;

      await db
        .update(s.variants)
        .set({
          caption: draft.caption,
          hashtags: JSON.stringify(draft.hashtags),
          mediaIds: JSON.stringify(draft.mediaIds),
          specState: verdict.state,
          specVersion: specVersionFor(platform),
          revision: nextRevision,
          updatedAt: Date.now(),
        })
        .where(eq(s.variants.id, variantId));

      // Content changes move a post forward out of `idea`, but never backwards out of `approved` here —
      // approval invalidation is M4's hash, and pretending to do it now would be a half-rule.
      if (post.status === "idea" || post.status === "researched") {
        await db
          .update(s.posts)
          .set({ status: "drafting", updatedAt: Date.now() })
          .where(eq(s.posts.id, post.id));
      }

      return {
        id: variantId,
        revision: nextRevision,
        specState: verdict.state,
        issues: verdict.issues,
        count: verdict.count,
        specVersion: specVersionFor(platform),
      };
    },

    /**
     * Copy a variant to another channel as an independent draft.
     *
     * Independent on purpose: the whole point of per-platform variants is that they diverge. A shared row
     * would make one platform's edit change another's caption.
     */
    async duplicateVariant(ctx: WorkspaceContext, variantId: string, channelId: string) {
      const c = requireCtx(ctx);
      const [source] = await db.select().from(s.variants).where(eq(s.variants.id, variantId)).limit(1);
      if (!source) return null;

      const [post] = await db
        .select({ id: s.posts.id, workspaceId: s.posts.workspaceId })
        .from(s.posts)
        .where(eq(s.posts.id, source.postId))
        .limit(1);
      if (!post || post.workspaceId !== c.workspaceId) return null;

      const platform = await platformFor(c, channelId);
      if (!platform) return null;

      const [taken] = await db
        .select({ id: s.variants.id })
        .from(s.variants)
        .where(and(eq(s.variants.postId, source.postId), eq(s.variants.channelId, channelId)))
        .limit(1);
      if (taken) return { id: taken.id, created: false as const };

      const id = `var_${crypto.randomUUID().slice(0, 8)}`;
      const verdict = validate(platform, {
        caption: source.caption,
        hashtags: parseList(source.hashtags),
        media: [],
      });

      await db.insert(s.variants).values({
        id,
        postId: source.postId,
        channelId,
        caption: source.caption,
        hashtags: source.hashtags,
        mediaIds: source.mediaIds,
        specState: verdict.state,
        specVersion: specVersionFor(platform),
        revision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await log(c, source.postId, "variant_duplicated", { from: variantId, to: id, platform });
      return { id, created: true as const };
    },

    /** Accept a warning, with the reason attached to it. Blocks are not overridable. */
    async acceptWarning(ctx: WorkspaceContext, variantId: string, input: { field: string; key: string; reason: string }) {
      const c = requireCtx(ctx);
      await db.insert(s.variantOverrides).values({
        id: `ovr_${crypto.randomUUID().slice(0, 8)}`,
        variantId,
        workspaceId: c.workspaceId,
        issueField: input.field,
        issueKey: input.key,
        reason: input.reason,
        actorId: c.userId,
        createdAt: Date.now(),
      });
      await log(c, null, "warning_accepted", { variantId, ...input });
      return true;
    },

  };
}

function redirect_unknown_channel(): never {
  // A channel outside this workspace is indistinguishable from one that does not exist — on purpose.
  throw new Error("unknown_channel");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
