#!/usr/bin/env node
/**
 * Vault importer — a Node CLI, deliberately not a Worker route.
 *
 * It reads a directory tree and file contents. A Worker has no filesystem, so making this an endpoint
 * would mean uploading the vault in order to import it: more work, more risk, worse ergonomics.
 *
 *   node tools/importer/cli.mjs                      # dry run against the default vault
 *   node tools/importer/cli.mjs --brand zavron
 *   node tools/importer/cli.mjs --commit --local     # write it
 *   node tools/importer/cli.mjs --commit --remote    # the real database — ask first
 *
 * Dry run is the default on purpose. The blast radius of a wrong import is "the database disagrees
 * with the vault and nobody noticed", so the destructive path costs a flag and buys a review.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapItemToRows } from "./map.mjs";
import { buildSql, summarise } from "./sql.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../..");
const DEFAULT_VAULT = "D:/uwi/Projetcs/Uwi's-Department";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const vault = resolve(option("--vault", DEFAULT_VAULT));
const onlyBrand = option("--brand");
const commit = flag("--commit");
const remote = flag("--remote");

if (!existsSync(vault)) {
  console.error(`vault not found: ${vault}`);
  process.exit(2);
}

// ── read the vault ────────────────────────────────────────────────────────────────────────────────

const dirs = (path) => {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function readAssets(assetPaths) {
  const resolved = [];
  for (const assetPath of assetPaths ?? []) {
    const absolute = resolve(vault, assetPath);
    if (!existsSync(absolute)) continue; // a render that has not happened yet is not an error
    const bytes = readFileSync(absolute);
    resolved.push({ path: assetPath, sha256: sha256(bytes), bytes: statSync(absolute).size });
  }
  return resolved;
}

const brands = dirs(join(vault, "brands")).filter((b) => !onlyBrand || b === onlyBrand);
const items = [];
const skipped = [];

for (const brandSlug of brands) {
  const brandDir = join(vault, "brands", brandSlug);
  const socialDir = join(brandDir, "social");
  if (!existsSync(socialDir)) continue;

  for (const platform of dirs(socialDir)) {
    const queueDir = join(socialDir, platform, "queue");
    if (!existsSync(queueDir)) continue;

    for (const itemId of dirs(queueDir)) {
      const itemDir = join(queueDir, itemId);
      const itemJsonPath = join(itemDir, "item.json");

      if (!existsSync(itemJsonPath)) {
        skipped.push({ itemId, platform, reason: "no item.json" });
        continue;
      }

      let item;
      try {
        item = JSON.parse(readFileSync(itemJsonPath, "utf8"));
      } catch (error) {
        skipped.push({ itemId, platform, reason: `unreadable item.json: ${error.message}` });
        continue;
      }

      const captionPath = join(itemDir, "caption.md");
      const captionMarkdown = existsSync(captionPath) ? readFileSync(captionPath, "utf8") : "";

      items.push(
        mapItemToRows({
          brand: { slug: brandSlug },
          itemId,
          item,
          platform,
          captionMarkdown,
          assets: readAssets(item.assets),
        }),
      );
    }
  }
}

// ── report ────────────────────────────────────────────────────────────────────────────────────────

const summary = summarise(items);
const conflicts = [];
const seen = new Map();
for (const item of items) {
  const key = `${item.post.brandSlug}/${item.variant.platform}/${item.post.externalRef}`;
  if (seen.has(key)) conflicts.push(`${key} claimed by two folders`);
  seen.set(key, true);
}

console.log(`\nvault      ${vault}`);
console.log(`brands     ${brands.join(", ") || "(none)"}`);
console.log(`platforms  ${summary.platforms.join(", ") || "(none)"}`);
console.log(
  `would write  ${summary.posts} posts · ${summary.variants} variants · ${summary.media} media ` +
    `(${summary.postableMedia} postable, ${summary.reviewArtifacts} review artifacts excluded)`,
);

if (skipped.length) {
  console.log(`\nskipped ${skipped.length}:`);
  for (const s of skipped) console.log(`  ${s.platform}/${s.itemId} — ${s.reason}`);
}

if (summary.problems.length || conflicts.length) {
  console.log(`\nproblems ${summary.problems.length + conflicts.length}:`);
  for (const p of summary.problems) console.log(`  ${p}`);
  for (const c of conflicts) console.log(`  conflict: ${c}`);
}

if (!commit) {
  console.log("\ndry run — nothing written. Re-run with --commit to apply.");
  process.exit(summary.problems.length || conflicts.length ? 1 : 0);
}

if (summary.problems.length || conflicts.length) {
  console.error("\nrefusing to commit: the diff disagrees with the source. Fix the problems above.");
  process.exit(1);
}

// ── commit ────────────────────────────────────────────────────────────────────────────────────────

const wrangler = join(APP_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const target = remote ? ["--remote", "--yes"] : ["--local"];

function query(sql) {
  const output = execFileSync(
    process.execPath,
    [wrangler, "d1", "execute", "postvyn-db", ...target, "--json", "--command", sql],
    { cwd: APP_ROOT, encoding: "utf8" },
  );
  return JSON.parse(output)?.at(-1)?.results ?? [];
}

const workspaceRow = query("select id from workspaces order by created_at limit 1")[0];
if (!workspaceRow) {
  console.error("no workspace in the target database — sign in once first, or seed one.");
  process.exit(1);
}

const brandsBySlug = new Map(
  query("select id, slug from brands").map((row) => [row.slug, row.id]),
);

const missingBrands = [...new Set(items.map((i) => i.post.brandSlug))].filter(
  (slug) => !brandsBySlug.has(slug),
);
if (missingBrands.length) {
  console.error(`brands missing from the database: ${missingBrands.join(", ")}. Create them first.`);
  process.exit(1);
}

const batchId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
let applied = 0;

for (const brandSlug of new Set(items.map((i) => i.post.brandSlug))) {
  const brandItems = items.filter((i) => i.post.brandSlug === brandSlug);
  const sql = buildSql({
    workspaceId: workspaceRow.id,
    brandId: brandsBySlug.get(brandSlug),
    brand: { slug: brandSlug },
    items: brandItems,
    batchId: `${batchId}_${brandSlug}`,
  });

  mkdirSync(join(APP_ROOT, ".importer"), { recursive: true });
  const outFile = join(APP_ROOT, ".importer", `${batchId}_${brandSlug}.sql`);
  writeFileSync(outFile, sql, "utf8");

  console.log(`\napplying ${brandItems.length} item(s) for brand "${brandSlug}" → ${remote ? "REMOTE" : "local"}`);
  execFileSync(
    process.execPath,
    [wrangler, "d1", "execute", "postvyn-db", ...target, `--file=${outFile}`],
    { cwd: APP_ROOT, stdio: "inherit" },
  );
  applied += brandItems.length;
  console.log(`  sql kept at ${outFile}`);
}

const after = query("select count(*) as posts from posts")[0];

// ── per-field verification ──────────────────────────────────────────────────────────────────────
// Counts prove nothing: an import that writes four posts with the wrong caption in all four has the
// right count. So every field that matters is read back and compared with what was mapped.
const mismatches = [];
for (const item of items) {
  const ref = item.post.externalRef.replace(/'/g, "''");
  const platform = item.variant.platform;
  const rows = query(
    `select p.title, p.status, p.format, v.caption, v.hashtags, v.media_ids, v.spec_state
     from posts p
     join variants v on v.post_id = p.id
     join channels c on c.id = v.channel_id
     where p.external_ref = '${ref}' and c.platform = '${platform}'`,
  );
  const row = rows[0];
  if (!row) {
    mismatches.push(`${ref} [${platform}] — no row after commit`);
    continue;
  }

  const checks = [
    ["title", row.title, item.post.title],
    ["status", row.status, item.post.status],
    ["format", row.format, item.post.format],
    ["caption", row.caption, item.variant.caption],
    ["hashtags", row.hashtags, JSON.stringify(item.variant.hashtags)],
    ["media order", row.media_ids, JSON.stringify(item.variant.mediaIds)],
  ];
  for (const [field, stored, expected] of checks) {
    if (stored !== expected) {
      const detail =
        field === "caption"
          ? `${String(stored ?? "").length} vs ${String(expected ?? "").length} characters`
          : `${JSON.stringify(stored)} vs ${JSON.stringify(expected)}`;
      mismatches.push(`${ref} [${platform}] ${field}: ${detail}`);
    }
  }
}

if (mismatches.length) {
  console.error(`\n${mismatches.length} field mismatch(es) after commit:`);
  for (const line of mismatches) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`\ndone — ${applied} item(s) applied and verified field by field, ${after?.posts ?? "?"} posts in the database.`);
