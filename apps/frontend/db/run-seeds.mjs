#!/usr/bin/env node
/**
 * Applies every seed in order, against the local or remote D1.
 *
 *   node db/run-seeds.mjs            → --local  (file-backed D1, safe, default)
 *   node db/run-seeds.mjs --remote   → the real database, `--yes` passed through
 *
 * Seeds must be idempotent: `INSERT OR IGNORE` with fixed ids, so running the set twice leaves the
 * same rows. That is a requirement, not a style preference — a seed that duplicates on re-run is a
 * seed nobody dares run again.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const remote = process.argv.includes("--remote");

const files = readdirSync(join(here, "seeds"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("no seeds to apply");
  process.exit(0);
}

const bin = join(appRoot, "node_modules", "wrangler", "bin", "wrangler.js");

console.log(`applying ${files.length} seed(s) to ${remote ? "REMOTE" : "local"} D1\n`);

for (const file of files) {
  const args = ["d1", "execute", "postvyn-db", `--file=db/seeds/${file}`, remote ? "--remote" : "--local"];
  if (remote) args.push("--yes");

  console.log(`→ ${file}`);
  const result = spawnSync(process.execPath, [bin, ...args], { cwd: appRoot, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n✗ seed failed: ${file}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\n✓ ${files.length} seed(s) applied`);
