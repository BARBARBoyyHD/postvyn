#!/usr/bin/env node
/**
 * Enforces the migration and seed naming convention.
 *
 * Migrations:  NNNN_<verb>_<object>.sql          e.g. 0001_create_workspaces_table.sql
 * Seeds:       NNNN_seed_<what>_into_<table>.sql e.g. 0001_seed_default_workspace_into_workspaces.sql
 *
 * Why a script: wrangler records the FILE NAME in `d1_migrations` when it applies one, so a name is
 * permanent. Renaming after the fact means the migration applies twice or never again — which is
 * why this runs before anything is applied, and in CI.
 */
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const VERBS = new Set([
  "create", "add", "alter", "drop", "rename", "backfill", "index", "enforce", "split", "merge",
]);

// Names that say nothing about what changed. A migration name is the only history some future
// reader gets, so "fix", "update" and "temp" are banned outright.
const BANNED = new Set([
  "fix", "fixes", "update", "updates", "changes", "change", "misc", "temp", "tmp", "test",
  "wip", "stuff", "new", "draft",
]);

const problems = [];
const seen = new Map();

function checkDir(kind, dir, test) {
  const full = join(here, dir);
  let entries;
  try {
    entries = readdirSync(full);
  } catch {
    problems.push(`${kind}: directory ${dir} is missing`);
    return [];
  }

  const files = entries.filter((f) => f.endsWith(".sql")).sort();
  for (const entry of entries) {
    if (!entry.endsWith(".sql")) {
      if (statSync(join(full, entry)).isFile()) {
        problems.push(`${kind}: "${entry}" is not a .sql file`);
      }
    }
  }

  for (const file of files) {
    const match = test.exec(file);
    if (!match) {
      problems.push(
        `${kind}: "${file}" does not match ${kind === "migration"
          ? "NNNN_<verb>_<object>.sql (verbs: " + [...VERBS].join(", ") + ")"
          : "NNNN_seed_<what>_into_<table>.sql"}`,
      );
      continue;
    }
    const number = match[1];
    if (seen.has(`${kind}${number}`)) {
      problems.push(`${kind}: number ${number} used twice — "${seen.get(kind + number)}" and "${file}"`);
    }
    seen.set(`${kind}${number}`, file);

    // words that carry no information
    for (const word of file.replace(/\.sql$/, "").split(/[_0-9]+/)) {
      if (BANNED.has(word)) {
        problems.push(`${kind}: "${file}" contains the uninformative word "${word}"`);
      }
    }
  }

  // numbers must be unique and dense from 1 — a gap means a missing migration
  const numbers = files
    .map((f) => Number.parseInt(f.slice(0, 4), 10))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  numbers.forEach((n, i) => {
    if (n !== i + 1) {
      problems.push(`${kind}: numbering must run 0001..${String(numbers.length).padStart(4, "0")} with no gaps — expected ${String(i + 1).padStart(4, "0")}, found ${String(n).padStart(4, "0")}`);
    }
  });

  return files;
}

const migrations = checkDir("migration", "migrations", /^(\d{4})_(create|add|alter|drop|rename|backfill|index|enforce|split|merge)_[a-z][a-z0-9_]*\.sql$/);
const seeds = checkDir("seed", "seeds", /^(\d{4})_seed_[a-z][a-z0-9_]*_into_[a-z][a-z0-9_]*\.sql$/);

if (problems.length > 0) {
  console.error(`\n✗ naming check failed (${problems.length})\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("");
  process.exit(1);
}

console.log(`✓ ${migrations.length} migration(s), ${seeds.length} seed(s) — names conform`);
