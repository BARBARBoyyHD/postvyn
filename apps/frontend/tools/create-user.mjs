#!/usr/bin/env node
/**
 * Create the first user.
 *
 * There is no public sign-up — by design, this is a personal tool, not a SaaS. But a database with no
 * user is an app nobody can enter, so the door is a CLI on the machine that owns the database, not a
 * route on the internet.
 *
 *   pnpm user:create you@example.com "Your Name"            # local D1
 *   pnpm user:create you@example.com "Your Name" --remote   # deployed D1 (needs wrangler login)
 *
 * The password comes from POSTVYN_PASSWORD, or is generated and printed once. It is never echoed by
 * this script in any other form, and it is stored as a scrypt hash by Better Auth's own hasher — the
 * same function the sign-in path verifies with, so there is no second implementation to drift.
 */
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";

const DATABASE = "postvyn-db";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const [email, nameArg] = args.filter((arg) => !arg.startsWith("--"));

if (!email || !email.includes("@")) {
  console.error('usage: pnpm user:create <email> "<name>" [--remote]');
  process.exit(2);
}

// Quoting is the one thing this script cannot get wrong: the value goes into SQL.
if (/['\\;]/.test(email) || /['\\;]/.test(nameArg ?? "")) {
  console.error("refusing: quotes and semicolons are not allowed in the name or email");
  process.exit(2);
}

const name = (nameArg ?? email.split("@")[0]).trim();
const password = process.env.POSTVYN_PASSWORD ?? randomBytes(12).toString("base64url");
const generated = !process.env.POSTVYN_PASSWORD;

const userId = randomUUID();
const accountId = randomUUID();
const now = Date.now();

// `email_verified = 1`: this account was created by someone with database access. Requiring a click on
// an email we sent to ourselves would be ceremony, not verification.
const passwordHash = await hashPassword(password);

/** Runs one batch against the chosen database. `--json` only on reads; inserts report nothing. */
function wranglerSql(sql, json = false) {
  const args = ["d1", "execute", DATABASE, "--command", sql, remote ? "--remote" : "--local"];
  if (json) args.push("--json");
  try {
    return execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    console.error("wrangler failed:");
    console.error(error.stderr?.toString() || error.message);
    process.exit(1);
  }
}

const existing = JSON.parse(
  wranglerSql(`select id from "user" where email = '${email.toLowerCase()}'`, true) || "[]",
)[0]?.results ?? [];

if (existing.length > 0) {
  console.error(`${email.toLowerCase()} already exists (${existing[0].id})`);
  console.error("this tool only creates accounts; it will not change an existing password");
  process.exit(1);
}

wranglerSql(`
insert into "user" (id, name, email, email_verified, created_at, updated_at)
values ('${userId}', '${name}', '${email.toLowerCase()}', 1, ${now}, ${now});

insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
values ('${accountId}', '${userId}', 'credential', '${userId}', '${passwordHash}', ${now}, ${now});
`);

// Verify by reading it back: an insert whose output nobody checked is an insert nobody can trust.
const created = JSON.parse(
  wranglerSql(
    `select u.id, u.email, (select count(*) from account a where a.user_id = u.id and a.provider_id = 'credential') as creds
     from "user" u where u.id = '${userId}'`,
    true,
  ) || "[]",
)[0]?.results ?? [];

if (created.length === 0 || Number(created[0].creds) !== 1) {
  console.error("the user row was not readable after insert — nothing usable was created");
  process.exit(1);
}

console.log(`created ${email.toLowerCase()} in ${remote ? "remote" : "local"} ${DATABASE}`);
console.log(`  user id   ${userId}`);
console.log(`  workspace bound on first sign-in (owner)`);
if (generated) {
  console.log(`  password  ${password}`);
  console.log("  (shown once — set POSTVYN_PASSWORD next time to choose your own)");
}
