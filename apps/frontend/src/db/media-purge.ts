/**
 * The media purge: bytes nothing can reach, once they are older than anyone could want them.
 *
 * The rule is quoted from `docs/003-ITA.md` §5 ("Retention"), not invented here: "Orphan media is
 * purged only when unreferenced for 30 days and `postable = false`." Every clause carries weight — a
 * postable asset is somebody's work, and a variant's media is what a published post still points at
 * long after the platform copied it.
 *
 * Two leaks, one sweep:
 *  - a non-postable row (contact sheet, preview) and the object it names;
 *  - an object under `media/<workspace>/` that no row names at all — an upload minted and never
 *    recorded, or what a deleted workspace left behind. Every other query in the app starts from a
 *    row, so nothing else will ever see these bytes again.
 *
 * The reference check runs twice: when listing, and again inside the statement that deletes. The
 * second is the one that makes this safe — a variant that gains the media between the two keeps its
 * bytes, and the row is reported as skipped rather than claimed as deleted.
 *
 * Order is row first, object second. A row left without its object publishes a 404 the operator
 * cannot act on; an object left without its row is invisible, and the orphan pass reclaims it later.
 */
import { and, eq, lt, sql } from "drizzle-orm";

import { createDb, type Database } from "./client";
import * as s from "./schema";
import { R2_KEY_PREFIX, objectKey } from "@/lib/media/address";
import { systemContext, type WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";

/** `docs/003-ITA.md` §5: "unreferenced for 30 days". Weeks rather than days would be a different rule. */
const MEDIA_RETENTION_DAYS = 30;
export const MEDIA_RETENTION_MS = MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** What one deletion is: `{ key, bytes, reason }`, as the spec's dry run asks for. */
export type PurgeCandidate =
  | {
      reason: "non_postable_media";
      workspaceId: string;
      mediaId: string;
      /** Null for a row imported from the vault and never uploaded — its path is not an object. */
      key: string | null;
      bytes: number;
    }
  | { reason: "orphan_object"; workspaceId: string; key: string; bytes: number };

export interface PurgeReport {
  dryRun: boolean;
  /** Everything past the window and referenced by nothing — the dry run's list and the log line. */
  candidates: PurgeCandidate[];
  deleted: PurgeCandidate[];
  /** Listed, then claimed by a variant before the delete: the guard refused and nothing was removed. */
  skipped: PurgeCandidate[];
  /** One item the store refused. The sweep carried on; the next run retries it. */
  failed: { item: PurgeCandidate; error: string }[];
}

export type PurgeResult =
  | ({ ok: true } & PurgeReport)
  | { ok: false; reason: "no_bucket"; message: string };

export interface PurgeOptions {
  dryRun?: boolean;
  now?: number;
  /** Test seam. Production passes nothing: the Worker's R2 binding is the bucket. */
  bucket?: PurgeBucket;
}

/** A bucket, narrowed to the two calls a sweep makes — so a test can refuse a delete without R2. */
export type PurgeBucket = Pick<R2Bucket, "delete" | "list">;

export function mediaPurge(env: WorkerEnv) {
  return {
    /** One workspace. Every query below carries the workspace id (D1 has no RLS, ADR-014). */
    async sweep(ctx: WorkspaceContext, options: PurgeOptions = {}): Promise<PurgeResult> {
      const storage = bucketFor(env, options.bucket);
      if (!storage.ok) return storage;

      const cutoff = (options.now ?? Date.now()) - MEDIA_RETENTION_MS;
      const db = createDb(env.DB);
      const candidates = [
        ...(await agedRows(db, ctx.workspaceId, cutoff)),
        ...(await orphanObjects(db, storage.bucket, ctx.workspaceId, cutoff)),
      ];
      const report: PurgeReport = {
        dryRun: options.dryRun ?? false,
        candidates,
        deleted: [],
        skipped: [],
        failed: [],
      };

      // "Deletion is recorded before it happens" (spec: media-hygiene). One line per workspace with
      // work to do — an idle sweep stays silent, so the cron log lists deletions, not heartbeats.
      if (candidates.length > 0) {
        console.log(
          "[media] purge",
          JSON.stringify({
            workspaceId: ctx.workspaceId,
            dryRun: report.dryRun,
            bytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
            candidates,
          }),
        );
      }
      if (report.dryRun) return { ok: true, ...report };

      for (const item of candidates) {
        const outcome = await purgeItem(db, storage.bucket, ctx.workspaceId, item, cutoff);
        if (outcome.state === "deleted") report.deleted.push(item);
        if (outcome.state === "skipped") report.skipped.push(item);
        if (outcome.state === "failed") report.failed.push({ item, error: outcome.error });
      }
      return { ok: true, ...report };
    },
  };
}

/**
 * Every workspace's sweep, for the cron.
 *
 * Takes no `WorkspaceContext` because it chooses no tenant — it walks them, the way the token
 * refresh does. A workspace that fails mid-run is not allowed to stop the others: the failures are
 * collected in the report and the loop carries on.
 */
export async function runMediaPurge(env: WorkerEnv, options: PurgeOptions = {}): Promise<PurgeResult> {
  const storage = bucketFor(env, options.bucket);
  if (!storage.ok) return storage;

  const db = createDb(env.DB);
  const sweep = mediaPurge(env);
  const report: PurgeReport = {
    dryRun: options.dryRun ?? false,
    candidates: [],
    deleted: [],
    skipped: [],
    failed: [],
  };

  for (const workspace of await db.select({ id: s.workspaces.id }).from(s.workspaces)) {
    const swept = await sweep.sweep(systemContext(workspace.id), options);
    if (!swept.ok) return swept;
    report.candidates.push(...swept.candidates);
    report.deleted.push(...swept.deleted);
    report.skipped.push(...swept.skipped);
    report.failed.push(...swept.failed);
  }

  return { ok: true, ...report };
}

/** Non-postable rows past the window that no variant of this workspace points at. */
async function agedRows(db: Database, workspaceId: string, cutoff: number): Promise<PurgeCandidate[]> {
  const rows = await db
    .select({ id: s.media.id, key: s.media.key, r2Key: s.media.r2Key, bytes: s.media.bytes })
    .from(s.media)
    .where(
      and(
        eq(s.media.workspaceId, workspaceId),
        eq(s.media.postable, false),
        lt(s.media.createdAt, cutoff),
        unreferenced(workspaceId),
      ),
    );

  return rows.map((row) => ({
    reason: "non_postable_media" as const,
    workspaceId,
    mediaId: row.id,
    key: objectKey(row),
    bytes: row.bytes,
  }));
}

/**
 * Objects in this workspace's prefix that no row names, past the window.
 *
 * The window is what keeps an upload in flight out of this list: a minted key exists in the bucket
 * between the browser's PUT and `record()`, and 30 days is far longer than the 10-minute URL.
 */
async function orphanObjects(
  db: Database,
  bucket: PurgeBucket,
  workspaceId: string,
  cutoff: number,
): Promise<PurgeCandidate[]> {
  const rows = await db
    .select({ key: s.media.key, r2Key: s.media.r2Key })
    .from(s.media)
    .where(eq(s.media.workspaceId, workspaceId));
  const named = new Set(rows.map(objectKey).filter((key): key is string => key !== null));

  const orphans: PurgeCandidate[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `${R2_KEY_PREFIX}${workspaceId}/`, cursor });
    for (const object of page.objects) {
      if (named.has(object.key) || object.uploaded.getTime() >= cutoff) continue;
      orphans.push({ reason: "orphan_object", workspaceId, key: object.key, bytes: object.size });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return orphans;
}

type PurgeOutcome = { state: "deleted" } | { state: "skipped" } | { state: "failed"; error: string };

/** Row, then object. A throw from either is one item's failure, never the sweep's. */
async function purgeItem(
  db: Database,
  bucket: PurgeBucket,
  workspaceId: string,
  item: PurgeCandidate,
  cutoff: number,
): Promise<PurgeOutcome> {
  try {
    if (item.reason === "non_postable_media") {
      const removed = await deleteRow(db, workspaceId, item.mediaId, cutoff);
      if (!removed) return { state: "skipped" };
    }
    if (item.key) await bucket.delete(item.key);
    return { state: "deleted" };
  } catch (error) {
    return { state: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The guarded delete: the listing's conditions again, in the statement itself.
 *
 * False means the row is already gone or no longer qualifies — a variant claimed the media, or a
 * second sweep got there first. The caller then leaves the object alone: deleting bytes a variant
 * just started pointing at cannot be undone from this side.
 */
async function deleteRow(
  db: Database,
  workspaceId: string,
  mediaId: string,
  cutoff: number,
): Promise<boolean> {
  const removed = await db
    .delete(s.media)
    .where(
      and(
        eq(s.media.workspaceId, workspaceId),
        eq(s.media.id, mediaId),
        eq(s.media.postable, false),
        lt(s.media.createdAt, cutoff),
        unreferenced(workspaceId),
      ),
    )
    .returning({ id: s.media.id });
  return removed.length > 0;
}

/**
 * "A variant still points at it", as SQL: `variants.media_ids` is a JSON array of media ids.
 *
 * Scoped through the variant's post, because that is where the workspace lives — and a variant in
 * another workspace naming this media would be a bug this check should refuse to paper over.
 */
function unreferenced(workspaceId: string) {
  return sql`not exists (
    select 1
    from ${s.variants} v
    join ${s.posts} p on p.id = v.post_id
    join json_each(coalesce(v.media_ids, '[]')) j
    where p.workspace_id = ${workspaceId} and j.value = ${s.media.id}
  )`;
}

function bucketFor(
  env: WorkerEnv,
  injected: PurgeBucket | undefined,
): { ok: true; bucket: PurgeBucket } | { ok: false; reason: "no_bucket"; message: string } {
  const bucket = injected ?? env.MEDIA;
  if (bucket) return { ok: true, bucket };
  return {
    ok: false,
    reason: "no_bucket",
    message:
      "the MEDIA R2 binding is absent, so there is no bucket to purge — nothing was deleted. Set " +
      "r2_buckets in wrangler.jsonc before relying on the sweep.",
  };
}
