#!/usr/bin/env node
/**
 * Agent tokens: create, list, revoke.
 *
 *   pnpm agent:token create --brand zavron --label "hermes-reels"
 *   pnpm agent:token list
 *   pnpm agent:token revoke --label "hermes-reels"
 *   pnpm agent:token create ... --remote        (needs wrangler login)
 *
 * The token is printed once and stored only as a SHA-256 hash. There is deliberately no `show` command:
 * a token that can be recovered from the database is a token that can be recovered by anyone who reads
 * a backup.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const DATABASE = "postvyn-db";
const TOKEN_PREFIX = "pvt_";

const args = process.argv.slice(2);
const command = args[0];
const remote = args.includes("--remote");
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : (args[index + 1] ?? null);
};

function sql(statement, json = false) {
  const argv = ["d1", "execute", DATABASE, "--command", statement, remote ? "--remote" : "--local"];
  if (json) argv.push("--json");
  try {
    return execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...argv], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    console.error(error.stderr?.toString() || error.message);
    process.exit(1);
  }
}

function rows(statement) {
  const parsed = JSON.parse(sql(statement, true) || "[]");
  return parsed[0]?.results ?? [];
}

async function hash(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safe(value, what) {
  if (!value) {
    console.error(`missing --${what}`);
    process.exit(2);
  }
  if (/['\\;]/.test(value)) {
    console.error(`refusing: quotes and semicolons are not allowed in --${what}`);
    process.exit(2);
  }
  return value;
}

if (command === "create") {
  const slug = safe(flag("brand"), "brand");
  const label = safe(flag("label") ?? `agent-${Date.now().toString(36)}`, "label");

  const [brand] = rows(`select id, workspace_id, name from brands where slug = '${slug}' limit 1`);
  if (!brand) {
    console.error(`no brand with slug "${slug}" — try: pnpm agent:token list`);
    process.exit(1);
  }

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = TOKEN_PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tokenHash = await hash(token);
  const id = `tok_${randomUUID().slice(0, 8)}`;

  sql(`insert into agent_tokens (id, workspace_id, brand_id, label, token_hash, created_at)
       values ('${id}', '${brand.workspace_id}', '${brand.id}', '${label}', '${tokenHash}', ${Date.now()});`);

  const [check] = rows(`select id from agent_tokens where id = '${id}'`);
  if (!check) {
    console.error("token was not readable after insert — nothing usable was created");
    process.exit(1);
  }

  console.log(`token created for brand ${brand.name} (${slug}) · label "${label}"`);
  console.log(`  ${token}`);
  console.log("  shown once. Store it where the agent reads it, not in this repo.");
  console.log(`  revoke with: pnpm agent:token revoke --label "${label}"`);
} else if (command === "list") {
  const list = rows(
    `select t.label, b.slug as brand, t.last_used_at, t.revoked_at
     from agent_tokens t join brands b on b.id = t.brand_id
     order by t.created_at desc`,
  );
  if (list.length === 0) {
    console.log("no tokens");
  } else {
    for (const row of list) {
      const state = row.revoked_at ? "revoked" : row.last_used_at ? "used" : "unused";
      console.log(`  ${row.label.padEnd(24)} ${row.brand.padEnd(12)} ${state}`);
    }
  }
} else if (command === "revoke") {
  const label = safe(flag("label"), "label");
  sql(`update agent_tokens set revoked_at = ${Date.now()} where label = '${label}' and revoked_at is null;`);
  const [still] = rows(`select count(*) as n from agent_tokens where label = '${label}' and revoked_at is null`);
  if (Number(still?.n ?? 0) > 0) {
    console.error(`"${label}" is still active — the update did not apply`);
    process.exit(1);
  }
  console.log(`revoked "${label}"`);
} else {
  console.error('usage: pnpm agent:token <create|list|revoke> [--brand slug] [--label name] [--remote]');
  process.exit(2);
}
