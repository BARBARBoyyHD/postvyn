/**
 * Rows → idempotent SQL.
 *
 * The importer never issues ad hoc writes: it builds one SQL file, prints it in dry-run, and applies
 * it in a single `wrangler d1 execute --file` when told to commit. One file means one reviewable
 * artifact, and a run that can be re-read after the fact.
 *
 * Every statement is an upsert keyed on the schema's own unique indexes, so running the importer
 * twice is an update, never a duplicate. Where a row has no natural upsert target (work on a channel
 * that may already exist), it says `DO NOTHING` rather than guessing at a merge.
 */

const q = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
};

const insert = (table, columns, values) =>
  `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.map(q).join(", ")})`;

/**
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} input.brandId
 * @param {{slug: string}} input.brand
 * @param {ReturnType<import("./map.mjs").mapItemToRows>[]} input.items
 * @param {string} input.batchId
 */
export function buildSql({ workspaceId, brandId, brand, items, batchId }) {
  const now = "cast(unixepoch('subsecond') * 1000 as integer)";
  const statements = [];

  // Channels first: a variant references one. `reauth_required` because an imported channel has no
  // credentials yet — calling it `active` would be a lie the publisher would later act on.
  const platforms = [...new Set(items.map((i) => i.variant.platform))].sort();
  for (const platform of platforms) {
    statements.push(
      `${insert(
        "channels",
        ["id", "brand_id", "platform", "account_ref", "label", "status", "created_at", "updated_at"],
        [
          `chn_${brand.slug}_${platform}`,
          brandId,
          platform,
          "unlinked",
          `${platform} (imported — not connected)`,
          "reauth_required",
          now,
          now,
        ],
      )} ON CONFLICT (brand_id, platform, account_ref) DO NOTHING;`,
    );
  }

  for (const item of items) {
    const p = item.post;
    statements.push(
      `${insert(
        "posts",
        [
          "id",
          "workspace_id",
          "brand_id",
          "title",
          "format",
          "status",
          "pillar",
          "schedule_at",
          "external_ref",
          "created_by",
          "created_at",
          "updated_at",
        ],
        [
          p.id,
          workspaceId,
          brandId,
          p.title,
          p.format,
          p.status,
          p.pillar,
          p.scheduleAt,
          p.externalRef,
          null,
          now,
          now,
        ],
      )} ON CONFLICT (brand_id, external_ref) DO UPDATE SET
        title = excluded.title,
        format = excluded.format,
        status = excluded.status,
        pillar = excluded.pillar,
        schedule_at = excluded.schedule_at,
        updated_at = excluded.updated_at;`,
    );

    for (const m of item.media) {
      statements.push(
        `${insert(
          "media",
          [
            "id",
            "workspace_id",
            "hash",
            "key",
            "mime",
            "bytes",
            "width",
            "height",
            "postable",
            "created_at",
          ],
          [m.id, workspaceId, m.sha256, m.path, m.mime, m.bytes, null, null, m.postable, now],
        )} ON CONFLICT (workspace_id, hash) DO UPDATE SET
          key = excluded.key,
          bytes = excluded.bytes,
          postable = excluded.postable;`,
      );
    }

    const v = item.variant;
    statements.push(
      `${insert(
        "variants",
        [
          "id",
          "post_id",
          "channel_id",
          "caption",
          "hashtags",
          "media_ids",
          "spec_state",
          "created_at",
          "updated_at",
        ],
        [
          v.id,
          item.post.id,
          v.channelId,
          v.caption,
          JSON.stringify(v.hashtags),
          JSON.stringify(v.mediaIds),
          v.specState,
          now,
          now,
        ],
      )} ON CONFLICT (post_id, channel_id) DO UPDATE SET
        caption = excluded.caption,
        hashtags = excluded.hashtags,
        media_ids = excluded.media_ids,
        updated_at = excluded.updated_at;`,
    );

    // A vault item that already shipped keeps its record. `insert or ignore` on the id keeps a second
    // import from writing a duplicate publish row for the same URL.
    const pub = item.publish;
    if (pub) {
      statements.push(
        `${insert(
          "publish_results",
          ["id", "variant_id", "platform", "platform_post_id", "url", "raw", "state", "created_at"],
          [pub.id, v.id, pub.platform, pub.platformPostId, pub.url, null, pub.state, pub.createdAt],
        )} ON CONFLICT (id) DO NOTHING;`,
      );
    }
  }

  // One audit row per run, so a bad import can be found later without guessing which rows moved.
  statements.push(
    `${insert(
      "activity_log",
      ["id", "workspace_id", "post_id", "actor_id", "action", "detail", "created_at"],
      [
        `import_${batchId}`,
        workspaceId,
        null,
        null,
        "import.committed",
        JSON.stringify({ batchId, brand: brand.slug, posts: items.length }),
        now,
      ],
    )};`,
  );

  return statements.join("\n");
}

/** Counts for the dry-run report, so "what would happen" is a number, not a paragraph. */
export function summarise(items) {
  const posts = new Set(items.map((i) => i.post.id));
  const variants = items.length;
  const media = items.flatMap((i) => i.media);
  return {
    posts: posts.size,
    variants,
    media: media.length,
    postableMedia: media.filter((m) => m.postable).length,
    reviewArtifacts: media.filter((m) => !m.postable).length,
    platforms: [...new Set(items.map((i) => i.variant.platform))].sort(),
    problems: items.flatMap((i) => i.problems.map((p) => `${i.post.externalRef}: ${p}`)),
  };
}

