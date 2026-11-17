/**
 * The tenancy chokepoint.
 *
 * Every function here takes a `WorkspaceContext` and folds `ctx.workspaceId` into the `where` clause
 * itself. The caller never supplies a workspace id, so a caller cannot widen its own scope — the
 * classic multi-tenant bug where a handler trusts `?workspace=…` from the request.
 *
 * The Drizzle client is created inside `repository()` and never returned, so "just this once" raw
 * access is not available to the caller. That, plus the ESLint rule, is what stands in for the
 * row-level security D1 does not offer (ADR-014).
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { effectiveChannelStatus } from "@/lib/channel-state";
import type { WorkspaceContext } from "@/lib/context";
import type { Bindings } from "./bindings";
import { createDb } from "./client";
import * as s from "./schema";

export type Repository = ReturnType<typeof repository>;

/**
 * Runtime guard for the type contract.
 *
 * TypeScript rejects a missing context at compile time, but `as any` exists, and an untyped caller
 * in a script is one keystroke away. Refusing to query without a tenant scope turns "I forgot the
 * filter" from a silent leak into a loud failure.
 */
/** Every read goes through this: no workspace, no query. */
export function requireCtx(ctx: WorkspaceContext | null | undefined): WorkspaceContext {
  if (!ctx || typeof ctx.workspaceId !== "string" || ctx.workspaceId.length === 0) {
    throw new Error(
      "WorkspaceContext is required: refusing to query without a tenant scope (ADR-014)",
    );
  }
  return ctx;
}

export function repository(env: Bindings) {
  const db = createDb(env.DB);

  return {
    // ── workspace settings ────────────────────────────────────────────────────────────────────

    /** The switches and display zone the chrome and the due list need. One row, scoped by id. */
    async getWorkspaceSettings(input: WorkspaceContext) {
      const ctx = requireCtx(input);
      const [row] = await db
        .select({
          timezone: s.workspaces.timezone,
          publishingEnabled: s.workspaces.publishingEnabled,
        })
        .from(s.workspaces)
        .where(eq(s.workspaces.id, ctx.workspaceId))
        .limit(1);
      return row ?? null;
    },

    // ── brands ────────────────────────────────────────────────────────────────────────────────

    async listBrands(input: WorkspaceContext) {
      const ctx = requireCtx(input);
      return db
        .select()
        .from(s.brands)
        .where(eq(s.brands.workspaceId, ctx.workspaceId))
        // Creation order, not alphabetical: the first brand is the default one, and a default that
        // moves when somebody renames a brand is a surprise, not a feature.
        .orderBy(s.brands.createdAt, s.brands.id);
    },

    async getBrandById(input: WorkspaceContext, id: string) {
      const ctx = requireCtx(input);
      const [row] = await db
        .select()
        .from(s.brands)
        .where(and(eq(s.brands.id, id), eq(s.brands.workspaceId, ctx.workspaceId)))
        .limit(1);
      return row ?? null;
    },

    // ── channels ──────────────────────────────────────────────────────────────────────────────

    /**
     * Channels carry no `workspace_id` — tenancy reaches them through their brand. The join is not
     * an optimisation, it is the only correct way to scope this table; a plain `select * from
     * channels` would leak every tenant's channels.
     *
     * `status` is derived, not read: a channel with no credential row is `reauth_required` however
     * the column reads, so an imported channel cannot present as connected (spec: platform-connections
     * §"An imported, unconnected channel is not active"). The credential row itself is never selected
     * here — the join only asks whether one exists.
     */
    async listChannels(input: WorkspaceContext) {
      const ctx = requireCtx(input);
      const rows = await db
        .select({
          id: s.channels.id,
          brandId: s.channels.brandId,
          platform: s.channels.platform,
          accountRef: s.channels.accountRef,
          label: s.channels.label,
          status: s.channels.status,
          hasCredentials: sql<number>`${s.channelCredentials.channelId} is not null`,
        })
        .from(s.channels)
        .innerJoin(s.brands, eq(s.channels.brandId, s.brands.id))
        .leftJoin(s.channelCredentials, eq(s.channelCredentials.channelId, s.channels.id))
        .where(eq(s.brands.workspaceId, ctx.workspaceId))
        .orderBy(s.channels.platform);

      return rows.map(withEffectiveStatus);
    },

    async getChannelById(input: WorkspaceContext, id: string) {
      const ctx = requireCtx(input);
      const [row] = await db
        .select({
          id: s.channels.id,
          brandId: s.channels.brandId,
          platform: s.channels.platform,
          accountRef: s.channels.accountRef,
          label: s.channels.label,
          status: s.channels.status,
          hasCredentials: sql<number>`${s.channelCredentials.channelId} is not null`,
        })
        .from(s.channels)
        .innerJoin(s.brands, eq(s.channels.brandId, s.brands.id))
        .leftJoin(s.channelCredentials, eq(s.channelCredentials.channelId, s.channels.id))
        .where(and(eq(s.channels.id, id), eq(s.brands.workspaceId, ctx.workspaceId)))
        .limit(1);
      return row ? withEffectiveStatus(row) : null;
    },

    // ── posts ─────────────────────────────────────────────────────────────────────────────────

    /** Publishable media for the attach picker. Reference-only rows are excluded by design. */
    async listMedia(input: WorkspaceContext) {
      const ctx = requireCtx(input);
      return db
        .select({
          id: s.media.id,
          mime: s.media.mime,
          bytes: s.media.bytes,
          width: s.media.width,
          height: s.media.height,
          createdAt: s.media.createdAt,
        })
        .from(s.media)
        .where(and(eq(s.media.workspaceId, ctx.workspaceId), eq(s.media.postable, true)))
        .orderBy(s.media.createdAt);
    },

    async listPosts(input: WorkspaceContext, status?: s.Post["status"]) {
      const ctx = requireCtx(input);
      const scoped = status
        ? db
            .select()
            .from(s.posts)
            .where(and(eq(s.posts.workspaceId, ctx.workspaceId), eq(s.posts.status, status)))
        : db.select().from(s.posts).where(eq(s.posts.workspaceId, ctx.workspaceId));
      return scoped.orderBy(desc(s.posts.createdAt));
    },

    /**
     * Returns `null` for a row that exists in another workspace — deliberately indistinguishable
     * from an id that does not exist at all. A 404 that says "exists but not yours" leaks the
     * existence of other tenants' data.
     */
    async getPostById(input: WorkspaceContext, id: string) {
      const ctx = requireCtx(input);
      const [row] = await db
        .select()
        .from(s.posts)
        .where(and(eq(s.posts.id, id), eq(s.posts.workspaceId, ctx.workspaceId)))
        .limit(1);
      return row ?? null;
    },

    async countPosts(input: WorkspaceContext) {
      const ctx = requireCtx(input);
      const rows = await db
        .select({ id: s.posts.id })
        .from(s.posts)
        .where(eq(s.posts.workspaceId, ctx.workspaceId));
      return rows.length;
    },

    // ── brands: writes ───────────────────────────────────────────────────────────────────────

    async createBrand(
      input: WorkspaceContext,
      values: {
        slug: string;
        name: string;
        handle?: string | null;
        voice?: unknown;
        colors?: unknown;
      },
    ) {
      const ctx = requireCtx(input);
      const now = Date.now();
      const row = {
        id: crypto.randomUUID(),
        workspaceId: ctx.workspaceId, // never from the caller: the context decides the tenant
        slug: values.slug,
        name: values.name,
        handle: values.handle ?? null,
        voice: values.voice === undefined ? null : JSON.stringify(values.voice),
        colors: values.colors === undefined ? null : JSON.stringify(values.colors),
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(s.brands).values(row);
      return row;
    },

    async updateBrand(
      input: WorkspaceContext,
      id: string,
      values: {
        name?: string;
        handle?: string | null;
        voice?: unknown;
        colors?: unknown;
      },
    ) {
      const ctx = requireCtx(input);
      const existing = await this.getBrandById(ctx, id);
      if (!existing) return null; // indistinguishable from "not there" — see getBrandById

      const patch: Record<string, unknown> = { updatedAt: Date.now() };
      if (values.name !== undefined) patch.name = values.name;
      if (values.handle !== undefined) patch.handle = values.handle;
      if (values.voice !== undefined) patch.voice = JSON.stringify(values.voice);
      if (values.colors !== undefined) patch.colors = JSON.stringify(values.colors);

      await db
        .update(s.brands)
        .set(patch)
        .where(and(eq(s.brands.id, id), eq(s.brands.workspaceId, ctx.workspaceId)));

      return this.getBrandById(ctx, id);
    },

    // ── audit ────────────────────────────────────────────────────────────────────────────────

    /**
     * Append to the audit trail. The table refuses UPDATE and DELETE by trigger, so this is the only
     * write that can ever happen to it.
     */
    async recordActivity(
      input: WorkspaceContext,
      entry: { action: string; postId?: string | null; detail?: unknown },
    ) {
      const ctx = requireCtx(input);
      await db.insert(s.activityLog).values({
        id: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        postId: entry.postId ?? null,
        actorId: ctx.userId,
        action: entry.action,
        detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
        createdAt: Date.now(),
      });
    },

    async listActivity(input: WorkspaceContext, postId: string) {
      const ctx = requireCtx(input);
      return db
        .select()
        .from(s.activityLog)
        .where(and(eq(s.activityLog.workspaceId, ctx.workspaceId), eq(s.activityLog.postId, postId)))
        .orderBy(desc(s.activityLog.createdAt));
    },

    // ── post detail ──────────────────────────────────────────────────────────────────────────

    /**
     * Everything one post shows: its variants, the media they reference in publish order, the audit
     * trail, and the attempt/result rows that make the history readable. Six queries for a detail view
     * is fine — it is one post, not a page of cards.
     */
    async getPostDetail(input: WorkspaceContext, id: string) {
      const ctx = requireCtx(input);
      const post = await this.getPostById(ctx, id);
      if (!post) return null;

      const variantRows = await db
        .select({
          id: s.variants.id,
          postId: s.variants.postId,
          channelId: s.variants.channelId,
          caption: s.variants.caption,
          hashtags: s.variants.hashtags,
          mediaIds: s.variants.mediaIds,
          specState: s.variants.specState,
          specVersion: s.variants.specVersion,
          revision: s.variants.revision,
          platform: s.channels.platform,
          channelStatus: s.channels.status,
        })
        .from(s.variants)
        .innerJoin(s.channels, eq(s.variants.channelId, s.channels.id))
        .where(eq(s.variants.postId, id));

      const wanted = [
        ...new Set(
          variantRows.flatMap((v) => {
            try {
              return JSON.parse(v.mediaIds ?? "[]") as string[];
            } catch {
              return [];
            }
          }),
        ),
      ];

      const mediaRows = wanted.length
        ? await db
            .select()
            .from(s.media)
            .where(and(eq(s.media.workspaceId, ctx.workspaceId), inArray(s.media.id, wanted)))
        : [];

      const activity = await this.listActivity(ctx, id);

      const variantIds = variantRows.map((variant) => variant.id);

      // Attempts live on the job, keyed by the variant id inside its JSON payload. Scoped through the
      // variants we just read from this post, so a job cannot be pulled in from another tenant.
      const attemptRows = variantIds.length
        ? await db
            .select({
              id: s.jobs.id,
              variantId: sql<string>`json_extract(${s.jobs.payload}, '$.variantId')`,
              state: s.jobs.state,
              attempts: s.jobs.attempts,
              runAfter: s.jobs.runAfter,
              attemptStartedAt: s.jobs.attemptStartedAt,
              attemptFinishedAt: s.jobs.attemptFinishedAt,
              lastError: s.jobs.lastError,
            })
            .from(s.jobs)
            .where(
              inArray(
                sql<string>`json_extract(${s.jobs.payload}, '$.variantId')`,
                variantIds,
              ),
            )
            .orderBy(desc(s.jobs.createdAt))
        : [];

      // The publish read-back: `uncertain` is the one state that needs a human, so the detail view
      // must be able to see it without parsing the activity log.
      const publishRows = variantIds.length
        ? await db
            .select({
              id: s.publishResults.id,
              variantId: s.publishResults.variantId,
              platform: s.publishResults.platform,
              state: s.publishResults.state,
              url: s.publishResults.url,
              createdAt: s.publishResults.createdAt,
            })
            .from(s.publishResults)
            .where(inArray(s.publishResults.variantId, variantIds))
            .orderBy(desc(s.publishResults.createdAt))
        : [];

      return {
        post,
        variants: variantRows,
        media: mediaRows,
        activity,
        attempts: attemptRows,
        publishResults: publishRows,
      };
    },

    // ── review queue ─────────────────────────────────────────────────────────────────────────

    /**
     * Posts waiting for a human, with the variants an operator can approve in one action.
     *
     * `review` is the status the product uses for "no approval currently counts": approval moves the
     * post to `scheduled`, an edit or a revoke moves it back. Two queries, because the list is read as
     * one screen and a per-post variant query would be the N+1 the board test already forbids.
     */
    async listReviewQueue(
      input: WorkspaceContext,
      filters: { brandId: string; limit?: number },
    ) {
      const ctx = requireCtx(input);
      const limit = Math.min(Math.max(filters.limit ?? 60, 1), 100);

      const posts = await db
        .select()
        .from(s.posts)
        .where(
          and(
            eq(s.posts.workspaceId, ctx.workspaceId),
            eq(s.posts.brandId, filters.brandId),
            eq(s.posts.status, "review"),
          ),
        )
        .orderBy(s.posts.scheduleAt, s.posts.createdAt)
        .limit(limit);

      const variants = posts.length
        ? await db
            .select({
              id: s.variants.id,
              postId: s.variants.postId,
              caption: s.variants.caption,
              hashtags: s.variants.hashtags,
              mediaIds: s.variants.mediaIds,
              specState: s.variants.specState,
              platform: s.channels.platform,
            })
            .from(s.variants)
            .innerJoin(s.channels, eq(s.variants.channelId, s.channels.id))
            .where(
              inArray(
                s.variants.postId,
                posts.map((post) => post.id),
              ),
            )
            .orderBy(s.channels.platform)
        : [];

      return { posts, variants };
    },

    // ── work queue ───────────────────────────────────────────────────────────────────────────

    /**
     * Jobs due inside a window, for the operator's "what ships tomorrow" question.
     *
     * Scoped through the post, because a job row carries no workspace id — its payload names a variant
     * and the variant's post decides the tenant. Joining without that filter would list every tenant.
     */
    async listDueJobs(input: WorkspaceContext, window: { from: number; to: number }) {
      const ctx = requireCtx(input);
      return db
        .select({
          id: s.jobs.id,
          state: s.jobs.state,
          runAfter: s.jobs.runAfter,
          attempts: s.jobs.attempts,
          lastError: s.jobs.lastError,
          variantId: s.variants.id,
          platform: s.channels.platform,
          postId: s.posts.id,
          postTitle: s.posts.title,
          brandName: s.brands.name,
        })
        .from(s.jobs)
        .innerJoin(s.variants, sql`${s.variants.id} = json_extract(${s.jobs.payload}, '$.variantId')`)
        .innerJoin(
          s.posts,
          and(eq(s.variants.postId, s.posts.id), eq(s.posts.workspaceId, ctx.workspaceId)),
        )
        .innerJoin(s.brands, eq(s.posts.brandId, s.brands.id))
        .innerJoin(s.channels, eq(s.variants.channelId, s.channels.id))
        .where(
          and(
            sql`${s.jobs.state} in ('queued', 'awaiting_platform')`,
            gte(s.jobs.runAfter, window.from),
            lte(s.jobs.runAfter, window.to),
          ),
        )
        .orderBy(s.jobs.runAfter);
    },

    // ── board read model ─────────────────────────────────────────────────────────────────────

    /**
     * One board view, three queries, regardless of page size: counts, the page's posts, and the
     * variants that belong to those posts. A per-column or per-card query is how a screen that looks
     * fine locally blows the free-plan read budget in production.
     *
     * Pagination is a tuple cursor on `(status, schedule_at, id)` rather than OFFSET: rows are being
     * inserted by the importer while the operator pages, and OFFSET would duplicate or skip cards.
     */
    async listBoard(
      input: WorkspaceContext,
      filters: {
        brandId: string;
        limit?: number;
        cursor?: string | null;
        platform?: string | null;
        pillar?: string | null;
      },
    ) {
      const ctx = requireCtx(input);
      const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);

      const scope = and(
        eq(s.posts.workspaceId, ctx.workspaceId),
        eq(s.posts.brandId, filters.brandId),
        filters.pillar ? eq(s.posts.pillar, filters.pillar) : undefined,
        filters.platform
          ? sql`exists (select 1 from ${s.variants} v join ${s.channels} c on c.id = v.channel_id
                 where v.post_id = ${s.posts.id} and c.platform = ${filters.platform})`
          : undefined,
      );

      // 1. counts per status, on the filtered set — so a column shows what the filter leaves, not
      //    what the brand holds.
      const countRows = await db
        .select({ status: s.posts.status, n: sql<number>`count(*)` })
        .from(s.posts)
        .where(scope)
        .groupBy(s.posts.status);

      // 2. the page itself
      const cursor = decodeCursor(filters.cursor ?? null);
      const page = await db
        .select()
        .from(s.posts)
        .where(
          cursor
            ? and(
                scope,
                sql`(${s.posts.status}, coalesce(${s.posts.scheduleAt}, 0), ${s.posts.id})
                    > (${cursor.status}, ${cursor.scheduleAt}, ${cursor.id})`,
              )
            : scope,
        )
        .orderBy(s.posts.status, s.posts.scheduleAt, s.posts.id)
        .limit(limit + 1);

      const hasMore = page.length > limit;
      const posts = hasMore ? page.slice(0, limit) : page;

      // 3. variants for exactly these posts (empty page ⇒ no query)
      const variants = posts.length
        ? await db
            .select({
              id: s.variants.id,
              postId: s.variants.postId,
              channelId: s.variants.channelId,
              specState: s.variants.specState,
              platform: s.channels.platform,
              captionLength: sql<number>`length(${s.variants.caption})`,
            })
            .from(s.variants)
            .innerJoin(s.channels, eq(s.variants.channelId, s.channels.id))
            .where(
              and(
                inArray(
                  s.variants.postId,
                  posts.map((p) => p.id),
                ),
              ),
            )
        : [];

      const counts = Object.fromEntries(countRows.map((row) => [row.status, Number(row.n)]));

      return {
        counts,
        posts,
        variants,
        nextCursor: hasMore ? encodeCursor(posts[posts.length - 1]) : null,
      };
      },
  };
}

/**
 * Strip the credential-existence flag and answer with the state the board should show.
 *
 * The flag never leaves this function: whether a channel holds ciphertext is useful inside the query
 * and nobody's business in a response.
 */
function withEffectiveStatus(row: {
  id: string;
  brandId: string;
  platform: s.Channel["platform"];
  accountRef: string;
  label: string | null;
  status: s.Channel["status"];
  hasCredentials: number;
}) {
  return {
    id: row.id,
    brandId: row.brandId,
    platform: row.platform,
    accountRef: row.accountRef,
    label: row.label,
    status: effectiveChannelStatus(row.status, row.hasCredentials !== 0),
  };
}

/**
 * `Buffer` does not exist in `workerd`, so the cursor uses the Web platform's own base64 helpers.
 * Only ASCII statuses and ids go in, which is what keeps `btoa` safe here.
 */
function encodeCursor(post: { status: string; scheduleAt: number | null; id: string }): string {
  const payload = JSON.stringify({
    status: post.status,
    scheduleAt: post.scheduleAt ?? 0,
    id: post.id,
  });
  return btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(cursor: string | null): { status: string; scheduleAt: number; id: string } | null {
  if (!cursor) return null;
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(padded));
    if (typeof parsed.status !== "string" || typeof parsed.id !== "string") return null;
    return { status: parsed.status, scheduleAt: Number(parsed.scheduleAt) || 0, id: parsed.id };
  } catch {
    return null; // a corrupt cursor starts from the top rather than throwing at the operator
  }
}
