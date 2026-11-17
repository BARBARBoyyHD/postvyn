/**
 * The spec gate: may this content go to the platform at all?
 *
 * Recomputed from the row at the moment it matters rather than read from `variants.spec_state`. The
 * column is written by the composer, but rows also arrive through the importer and through
 * `duplicateVariant`, and the rules themselves are regenerated — an `ok` stored last week says nothing
 * about the limits in force now. `blocked` is the one verdict that must never be stale, because it is
 * the one that keeps a caption the platform would reject from leaving the building.
 *
 * Warnings do not gate. They were the operator's call in the composer (accept, with a reason), and
 * refusing them here would make the override decorative.
 */
import { eq, inArray } from "drizzle-orm";

import { createDb, type Bindings } from "./client";
import * as s from "./schema";
import type { Media, Variant } from "./schema";
import {
  specVersionFor,
  validate,
  type MediaFacts,
  type SpecIssue,
  type SpecLevel,
} from "@/lib/specs/validate";

export type SpecGateResult =
  | { ok: true; state: SpecLevel; specVersion: string | null }
  | { ok: false; violations: SpecIssue[] };

export function specGate(env: Bindings) {
  const db = createDb(env.DB);

  return {
    /**
     * The verdict for the row as it is stored now.
     *
     * A missing channel fails closed: `validate("")` reports "no rule set" as blocked, which is the
     * honest answer for a variant whose platform cannot be determined.
     */
    async check(variant: Variant): Promise<SpecGateResult> {
      const [channel] = await db
        .select({ platform: s.channels.platform })
        .from(s.channels)
        .where(eq(s.channels.id, variant.channelId))
        .limit(1);

      const ids = parseList(variant.mediaIds);
      const mediaRows = ids.length
        ? await db.select().from(s.media).where(inArray(s.media.id, ids))
        : [];

      const verdict = validate(channel?.platform ?? "", {
        caption: variant.caption,
        hashtags: parseList(variant.hashtags),
        media: mediaRows.map(toFacts),
      });

      if (verdict.state === "blocked") {
        return { ok: false, violations: verdict.issues.filter((issue) => issue.level === "blocked") };
      }

      return { ok: true, state: verdict.state, specVersion: specVersionFor(channel?.platform ?? "") };
    },
  };
}

function toFacts(row: Media): MediaFacts {
  return {
    bytes: Number(row.bytes),
    width: row.width ?? null,
    height: row.height ?? null,
    mime: row.mime,
    postable: Boolean(row.postable),
  };
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
