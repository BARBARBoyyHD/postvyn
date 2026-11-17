/**
 * Typed view of the schema — the source of truth for TYPES, not for the database.
 *
 * The database is built by the hand-written SQL in `db/migrations/` (see `db/README.md` for why).
 * This file mirrors that SQL so queries are typed and typos become compile errors. When the two
 * drift, the migration check and the isolation test are what catch it — never a comment.
 *
 * Conventions, all of them SQLite's fault: ids are TEXT uuids, timestamps are INTEGER unix-ms,
 * JSON is TEXT read with `json_extract()`.
 */
import { sql } from "drizzle-orm";
import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const nowMs = sql`(unixepoch() * 1000)`;

// ── tenancy ────────────────────────────────────────────────────────────────────────────────────

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    plan: text("plan", { enum: ["free", "paid"] }).notNull().default("free"),
    timezone: text("timezone").notNull().default("UTC"),
    /** ADR-019 kill switch. Publishing claims stop when false; queued jobs stay queued. */
    publishingEnabled: integer("publishing_enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [uniqueIndex("one_workspace_per_name").on(t.name)],
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("one_membership_per_user_per_workspace").on(t.userId, t.workspaceId),
    index("memberships_by_workspace").on(t.workspaceId),
  ],
);

// ── brand and channels ────────────────────────────────────────────────────────────────────────

export const brands = sqliteTable(
  "brands",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    handle: text("handle"),
    /** JSON: tone rules the caption writer obeys. */
    voice: text("voice"),
    /** JSON: accent + plate tokens. */
    colors: text("colors"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [uniqueIndex("one_brand_slug_per_workspace").on(t.workspaceId, t.slug)],
);

export const channels = sqliteTable(
  "channels",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["instagram", "threads", "x", "tiktok"] }).notNull(),
    /** The platform's own account id — never the mutable handle. */
    accountRef: text("account_ref").notNull(),
    label: text("label"),
    status: text("status", { enum: ["active", "reauth_required", "disabled"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("one_account_per_platform").on(t.brandId, t.platform, t.accountRef),
    index("channels_by_brand").on(t.brandId),
  ],
);

/** Split from `channels` so `select * from channels` can never carry a token. */
export const channelCredentials = sqliteTable(
  "channel_credentials",
  {
    channelId: text("channel_id")
      .primaryKey()
      .references(() => channels.id, { onDelete: "cascade" }),
    ciphertext: blob("ciphertext", { mode: "buffer" }).notNull(),
    iv: blob("iv", { mode: "buffer" }).notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [index("credentials_by_key_version").on(t.keyVersion)],
);

// ── content ───────────────────────────────────────────────────────────────────────────────────

export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    key: text("key").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** 0 = reference material (contact sheets, previews) and must never ship. */
    postable: integer("postable", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("one_media_per_hash_per_workspace").on(t.workspaceId, t.hash),
    index("media_postable_by_workspace").on(t.workspaceId, t.postable),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    format: text("format").notNull(),
    status: text("status", {
      enum: [
        "idea",
        "researched",
        "drafting",
        "review",
        "approved",
        "scheduled",
        "published",
        "failed",
        "archived",
      ],
    })
      .notNull()
      .default("idea"),
    pillar: text("pillar"),
    scheduleAt: integer("schedule_at"),
    /** Stable identity from the source system (vault item id). NULL for posts created in the app. */
    externalRef: text("external_ref"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [
    index("posts_by_brand_status").on(t.brandId, t.status),
    index("posts_due_by_status_time").on(t.status, t.scheduleAt),
  ],
);

export const variants = sqliteTable(
  "variants",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    caption: text("caption").notNull().default(""),
    /** JSON array of strings. */
    hashtags: text("hashtags"),
    /** JSON array, order preserved — carousel sequence. */
    mediaIds: text("media_ids"),
    specState: text("spec_state", { enum: ["unchecked", "ok", "warn", "blocked"] })
      .notNull()
      .default("unchecked"),
    specVersion: text("spec_version"),
    /** Monotonic per variant: a write older than the stored one is refused, not applied. */
    revision: integer("revision").notNull().default(0),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("one_variant_per_post_per_channel").on(t.postId, t.channelId),
    index("variants_by_channel").on(t.channelId),
  ],
);

/** Approval is bound to content: `variantHash` covers caption + hashtags + media order. */
export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    variantHash: text("variant_hash").notNull(),
    userId: text("user_id").notNull(),
    approvedAt: integer("approved_at").notNull().default(nowMs),
    revokedAt: integer("revoked_at"),
    note: text("note"),
  },
  (t) => [index("approvals_by_variant_latest").on(t.variantId, t.approvedAt)],
);

// ── work queue ────────────────────────────────────────────────────────────────────────────────

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    state: text("state", {
      enum: ["queued", "claimed", "awaiting_platform", "done", "failed", "dead"],
    })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: integer("run_after").notNull().default(nowMs),
    leaseUntil: integer("lease_until"),
    /** The latest attempt's window; `attempts` counts them, `activity_log` keeps the history. */
    attemptStartedAt: integer("attempt_started_at"),
    attemptFinishedAt: integer("attempt_finished_at"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [
    index("jobs_claimable").on(t.state, t.runAfter),
    index("jobs_by_lease").on(t.state, t.leaseUntil),
  ],
);

export const publishResults = sqliteTable(
  "publish_results",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["instagram", "threads", "x", "tiktok"] }).notNull(),
    platformPostId: text("platform_post_id"),
    url: text("url"),
    raw: text("raw"),
    state: text("state", { enum: ["succeeded", "failed", "uncertain"] }).notNull(),
    /** What the send was estimated to cost, in USD, kept so the price shown is the price spent. */
    estimatedCostUsd: real("estimated_cost_usd"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [
    // Partial unique index: many failures may accumulate, one success ever.
    uniqueIndex("one_publish_per_variant")
      .on(t.variantId)
      .where(sql`state = 'succeeded'`),
    index("publish_results_by_variant").on(t.variantId, t.createdAt),
  ],
);

/** Bearer tokens for agents. Hash-only: a token is compared, never replayed (ADR-011's mirror). */
export const agentTokens = sqliteTable(
  "agent_tokens",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: integer("created_at").notNull().default(nowMs),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
  },
  (table) => [index("idx_agent_tokens_workspace").on(table.workspaceId, table.revokedAt)],
);

/** Append-only; enforced by triggers in migration 0015, not by convention here. */
export const variantOverrides = sqliteTable(
  "variant_overrides",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    issueField: text("issue_field").notNull(),
    issueKey: text("issue_key").notNull(),
    reason: text("reason").notNull(),
    actorId: text("actor_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_variant_overrides_variant").on(table.variantId)],
);

/** Append-only; enforced by triggers in migration 0012, not by convention here. */
export const activityLog = sqliteTable(
  "activity_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    postId: text("post_id"),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    detail: text("detail"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [
    index("activity_by_workspace_time").on(t.workspaceId, t.createdAt),
    index("activity_by_post").on(t.postId, t.createdAt),
  ],
);

// ── row and insert types, so callers never re-declare a shape ─────────────────────────────────

export type Workspace = typeof workspaces.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Brand = typeof brands.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Media = typeof media.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Variant = typeof variants.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type PublishResult = typeof publishResults.$inferSelect;
export type ActivityEntry = typeof activityLog.$inferSelect;
