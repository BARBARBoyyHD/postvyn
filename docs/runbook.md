---
title: Operator runbook — Postvyn
type: runbook
doc: runbook
project: postvyn
status: active
updated: 2026-11-17
tags: [postvyn, runbook, operations]
aliases: [Runbook]
---

# Operator runbook

Five procedures, written for the person doing them at 11pm: connect a channel, rotate a token,
recover a failed job, re-run the importer, restore from an export. Everything here that can run on
this machine was run on 2026-11-17 — the D1 statements against the local database, the restore
against a scratch one, the importer as a dry run. The `--remote` and `https://` forms are the same
commands with the target swapped; if you change a command and cannot verify the result, say so in the
run instead of assuming it worked.

Two facts decide most of what follows:

- **Nothing publishes without an approval bound to the content.** An edit after approval voids it and
  the post returns to `review` — that is the product, not an obstacle.
- **A 200 is not success.** A publish counts only after the platform is read back. `uncertain` is a
  real outcome and it needs a human, not a retry.

Paths are relative to `apps/frontend` (the project root; the repo root has no `package.json`).
"Remote" means `--remote`, which needs `wrangler login` once.

## 0. Triage — where the truth is

| Question | Where |
|---|---|
| What happened to this post? | `/posts/<id>` — *Attempts*, *Results*, *History* |
| Is the app up, is D1 reachable, is R2 bound? | `/health` page, `/api/health` for a monitor |
| Which jobs are stuck, and why? | the query in §3.1 |
| Which channel needs a human? | `/channels` — `reconnect required` in amber |

```bash
# From apps/frontend — this one is a select.
pnpm exec wrangler d1 execute postvyn-db --remote --json \
  --command "select id, platform, status, account_ref from channels order by updated_at desc"
```

**→ If you skip triage** you fix the symptom the email named and miss that two channels are
`reauth_required` and four jobs are parked behind them. Read the state before changing it.

---

## 1. Connect a new channel

A channel is one platform account for one brand. Its credentials are encrypted into
`channel_credentials` with `TOKEN_ENCRYPTION_KEY`; the `channels` row carries only the account id
and its state. Connecting is owner-only.

### 1.1 Collect the values (before you open the app)

| Platform | Values the adapter reads | Where they come from |
|---|---|---|
| X | `apiKey`, `apiSecret`, `accessToken`, `accessSecret` | X developer portal, OAuth 1.0a user context |
| Instagram | `accessToken` (long-lived IG user token) | Meta app dashboard |
| Threads | `accessToken` (Threads user token) | Meta app dashboard |
| TikTok | none — never automated | the manual pack on the post page |

**→ If you skip this** you half-fill the form, the connect call fails with a `422`, and you have
pasted three of four secrets into a screen for nothing.

### 1.2 X — through the app

1. Sign in as the owner, open `/channels`, pick the brand in the switcher.
2. Fill **account id** — the platform's numeric user id, not the handle. Handles change; ids do not.
3. Fill the four credential fields, press **connect**.
4. The row appears as `connected`. The form clears itself on success.

**→ If you paste the handle instead of the id**, the channel looks connected and every publish fails
at the platform with an error that names an account you cannot find. Confirm the id in the X
developer portal before you type it.

### 1.3 Instagram / Threads — through the route (no form yet)

There is no connect form for Meta yet; the route is the contract. Take the session cookie from the
browser (DevTools → Network → any request → `Cookie:`), then:

```bash
curl -sX POST https://studio.<your-domain>/api/v1/channels \
  -H "content-type: application/json" -H "cookie: <paste the cookie header>" \
  -d '{"brandId":"<brand id>","platform":"instagram","accountRef":"17841400000000000",
       "label":"instagram · zavron","credentials":{"accessToken":"<long-lived token>"}}'
```

Re-posting the same `brandId` + `platform` + `accountRef` **updates** that channel rather than
creating a second one — that is what makes reconnect and refresh the same call.

**→ If you skip the exact `accountRef`**, `connect()` creates a *second* channel for the same
account. The next post then goes to whichever one its variant points at, and the board shows two
identical accounts.

### 1.4 Prove it landed

```bash
pnpm exec wrangler d1 execute postvyn-db --remote --json \
  --command "select c.id, c.platform, c.status, c.account_ref, cc.key_version
             from channels c left join channel_credentials cc on cc.channel_id = c.id"
```

`status` must be `active` and `key_version` must equal `TOKEN_ENCRYPTION_KEY_VERSION`.

**→ If `key_version` is null** there is no credential row at all and the next publish marks the
channel `reauth_required`. **If it is lower than the current version** the rotation pass in §2.2 was
never run for this row.

---

## 2. Rotate a token

Two different rotations live here. One is a Tuesday; the other is an incident.

### 2.1 One channel's platform token (the common case)

Same call as connecting, with the same `accountRef`. In the app: `/channels` → the same account id →
paste the new token(s) → connect. It rewrites the credential row and sets the channel `active`.

After the token is in, either press **publish now** on the affected post, or let the queue resume it:

```bash
curl -sX POST https://studio.<your-domain>/api/internal/tick \
  -H "authorization: Bearer $CRON_SECRET"
```

**→ Do not expect the tick to rescue a job parked for `reauth_required` immediately.** The tick
parks such a job for an hour on purpose (a credential is not fixed by retrying), and the manual tick
runs the same code — so it resumes only what is already due. If the post must go out tonight, the
button is the path; the tick is for everything else.

**→ If you rotate by editing rows in D1**, you write plaintext or an unreadable ciphertext into
`channel_credentials` and every channel becomes `reauth_required` with no way back except
reconnecting all of them. There is no supported hand-written path; do not invent one.

### 2.2 `TOKEN_ENCRYPTION_KEY` (the incident)

The key encrypts every stored token (AES-256-GCM, per-row IV, `channel_id` as AAD). Changing it
makes existing ciphertext unreadable until each row is re-encrypted under the new key.
`TOKEN_ENCRYPTION_KEY_VERSION` names the key; bump it, never reuse a number for different bytes.

**Today the re-encrypt pass has no caller.** `rotateCredentials(env, {from, to})` exists and is
tested in `src/db/credentials.ts`, but there is no route and no script that runs it (confirmed
2026-11-17 — see §6). The executable rotation is therefore "install the new key, then reconnect each
channel", which rewrites that channel's row under the new key:

1. Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Install it with its version — both, together:
   ```bash
   pnpm exec wrangler secret put TOKEN_ENCRYPTION_KEY          # the base64 bytes
   pnpm exec wrangler secret put TOKEN_ENCRYPTION_KEY_VERSION  # e.g. 2
   ```
   Locally the same two lines go into `.dev.vars`.
3. Reconnect every channel (§2.1). Until you do, the board shows `reconnect required` — that is the
   checklist, not a surprise.
4. Verify no row is left on the old key:
   ```bash
   pnpm exec wrangler d1 execute postvyn-db --remote --json \
     --command "select key_version, count(*) from channel_credentials group by key_version"
   ```

**→ If you install the new key without bumping the version**, new rows are stamped with the old
version number and a later pass cannot tell which key wrote them. The number is the only record.

**→ If you lose the old key before every row is rewritten**, those channels cannot be decrypted at
all: reconnect is the only recovery, and the platform token has to be minted again. Store the key
somewhere that is not the R2 bucket holding the backups.

---

## 3. Recover a failed job

A job is a row: the cron claims one, publishes one variant, writes what happened. The board shows
the same records; the queries here are for when you need them all at once.

| State | Means | What a human does |
|---|---|---|
| `queued` | waiting for its `run_after` | nothing, unless the switch is off |
| `awaiting_platform` | Meta accepted a container, the post is not ready | nothing — the next tick polls it |
| `failed` + `last_error` starts `uncertain:` | the platform may have accepted it | check the account **before** anything else |
| `dead` | terminal: attempts exhausted, spec blocked, reapproval needed, or out of credits | fix the cause, then §3.3 |
| any state, channel `reauth_required` | the credential is dead | §2.1 |

### 3.1 Read the failure — never guess it

```bash
pnpm exec wrangler d1 execute postvyn-db --remote --json --command \
"select id, kind, state, attempts, last_error,
        datetime(run_after/1000,'unixepoch') as run_after_utc
   from jobs order by updated_at desc limit 20"
```

Each attempt also raises `jobs.attempts` and stamps `attempt_started_at` / `attempt_finished_at`;
the post page renders those as *Attempts*. `publish_results` holds the platform's own words, and
`activity_log` holds `publish.cost_blocked` and `channel.reauth_required` as separate actions — read
those two first, because they are the two failures with a one-line fix.

### 3.2 Match the fix to the verdict

- **`uncertain:` prefix, or a `publish_results` row in state `uncertain`** — open the account and
  look. If the post is there: do nothing, and record it in the week's numbers as *uncertain*
  (m6 5.4 counts it). If it is not: edit nothing, press **publish now** on the post, which
  re-approves the content stored right now and sends once.
  **→ If you requeue an uncertain job** you risk a duplicate post that cannot be undone from this
  side. This is the one row where the safe action is "look first".
- **`cost_blocked:` or `publish.cost_blocked`** — X has no free tier and no balance API. Top up in
  the X developer portal, then declare it:
  ```bash
  pnpm exec wrangler secret put X_CREDITS_CONFIGURED   # value: true
  ```
  **→ If you retry before topping up** the adapter refuses again, one attempt is gone, and the job
  walks to `dead` for a billing reason.
- **`reauth_required`** — §2.1, then the tick.
- **`spec_blocked` / `reapproval_required`** — the content, not the queue: edit the variant, approve
  it again, press publish. Requeueing cannot fix text.
- **A plain transient `dead`** (platform 5xx, timeout) — §3.3.

### 3.3 Requeue, then run the tick by hand

There is no admin route for this yet (§6), so it is one statement plus the tick. The statement was
run against the local database on 2026-11-17; it matches nothing unless the id is exact, so paste it
from §3.1 rather than typing it.

```bash
pnpm exec wrangler d1 execute postvyn-db --remote --command \
"update jobs
    set state = 'queued', attempts = 0, last_error = null,
        run_after = strftime('%s','now')*1000, lease_until = null,
        attempt_started_at = null, attempt_finished_at = null,
        updated_at = strftime('%s','now')*1000
  where id = 'job_xxxxxxxxxx'"

curl -sX POST https://studio.<your-domain>/api/internal/tick \
  -H "authorization: Bearer $CRON_SECRET"
```

The tick and the cron are the same function, so a manual tick proves what 09:05 will do. It reports
`{"ok":true,"result":{"tick":{...},"tokens":{...}}}`; `tick.claimed` is how many jobs actually ran.

**→ If you requeue without resetting `attempts`**, the job is dead again on the next failure —
the count is what stops a poison job spinning.

**→ If the tick reports `claimed: 0`** the switch is off, not the queue. See §3.4.

Simpler alternative for one post: open `/posts/<id>` and press **publish now**. That path skips the
job row entirely (it is the button, not the schedule) and is what the product is actually used for.

### 3.4 The two kill switches

| Switch | Where | Off means |
|---|---|---|
| global | `vars.PUBLISHING_ENABLED` in `wrangler.jsonc` | no job is claimed at all, in any workspace |
| per workspace | `workspaces.publishing_enabled` | that workspace's jobs are skipped by the claim |

Flipping the global one is a config change and a deploy (it is a plain var, not a secret):

```bash
# edit wrangler.jsonc → vars.PUBLISHING_ENABLED: "true", then
pnpm exec wrangler deploy
```

The workspace one is a row; verified 2026-11-17:

```bash
pnpm exec wrangler d1 execute postvyn-db --remote --command \
"update workspaces set publishing_enabled = 1, updated_at = strftime('%s','now')*1000
  where id = '<workspace id>'"
```

**→ If you expect the tick to publish and it claims nothing**, check both rows before you debug the
adapter: the switch is checked at claim time, deliberately, so queued work stops the moment you hit
stop.

---

## 4. Re-run the importer

The vault is read; D1 is written. The full behaviour — dry run, `--brand`, `--commit --local`,
`--commit --remote`, review artifacts, hash dedupe, what it refuses — is in
[`db/README.md`](../apps/frontend/db/README.md#importing-the-vault). This section is only the
11pm sequence.

```bash
node tools/importer/cli.mjs                     # dry run, default vault — hits no database at all
node tools/importer/cli.mjs --brand zavron      # one brand
node tools/importer/cli.mjs --commit --local    # write to the dev database
node tools/importer/cli.mjs --commit --remote   # the real one — ask first
```

Verified dry run on 2026-11-17 against the current vault: `5 posts · 9 variants · 24 media (20
postable, 4 review artifacts excluded)`, exit 0, `dry run — nothing written`.

1. Always dry-run first; read the `problems` and `skipped` lines.
2. Commit only when the diff is what you expect. The commit re-reads every field it wrote and exits
   non-zero on a mismatch — counts prove nothing, field values do.
3. Keep the generated SQL: `.importer/<batch>_<brand>.sql`, and one `import.committed` row in
   `activity_log` per run.

**→ If you commit past the dry run** and the vault has a half-finished render, that item imports with
whatever is on disk. The dry run is the review; skipping it costs you a database that disagrees with
the vault and nobody noticed.

**→ If a brand is missing from the database** the importer refuses and lists the slugs — create the
brand first. It will not invent one, and you should not delete the item folder to get past it.

There is no `--reverse`. Identity is `(brand, external_ref)` for posts and `(post, channel)` for
variants, so the repair for a bad commit is to correct the vault and re-run — not to edit rows by
hand. **→ If you hand-edit imported rows**, the next run overwrites them and the SQL it keeps no
longer describes what happened.

---

## 5. Restore from an export

Three layers, cheapest first: D1 Time Travel (a window), the weekly export file (a backup), and the
migrations in git (schema, always). This section restores the middle one and was **verified on
2026-11-17** by restoring into a scratch local database.

### 5.1 First resort: Time Travel

```bash
pnpm exec wrangler d1 time-travel restore postvyn-db --timestamp=2026-11-16T22:00:00Z
```

Point-in-time, remote only, within the retention window (7 days free / 30 paid). It rewinds the
database in place — take an export *before* you run it if you are not certain, and check the
timestamp twice. **→ If you restore to the wrong instant**, posts published since that timestamp
return to their earlier state: a post that had already shipped is `scheduled` again, and the queue may
publish it a second time. There is no undo for a wrong rewind.

### 5.2 The export, restored into a scratch database

```bash
# 1. Export. Remote is the real backup; --local is the same file for a drill.
#    Write it outside the repo: it holds ciphertext for every channel and is not gitignored.
pnpm exec wrangler d1 export postvyn-db --remote --output=../postvyn-backup.sql

# 2. A scratch database to restore into, so the drill never touches the real one.
#    A scratch needs a config entry. Create wrangler.restore-check.jsonc with these contents
#    (temporary — deleted after the drill):
#
#      {
#        "name": "postvyn-restore-check",
#        "compatibility_date": "2026-11-01",
#        "d1_databases": [{ "binding": "DB", "database_name": "postvyn-restore-check",
#          "database_id": "00000000-0000-4000-8000-000000000001", "migrations_dir": "db/migrations" }]
#      }

# 3. Import the file — schema, data and the d1_migrations table all travel together.
pnpm exec wrangler d1 execute postvyn-restore-check --local \
  --config wrangler.restore-check.jsonc --file=../postvyn-backup.sql

# 4. Prove it: the restored database must agree with the source, not merely open.
pnpm exec wrangler d1 execute postvyn-restore-check --local --config wrangler.restore-check.jsonc \
  --json --command "select (select count(*) from workspaces) w, (select count(*) from brands) b,
    (select count(*) from posts) p, (select count(*) from variants) v,
    (select count(*) from d1_migrations) mig"
pnpm exec wrangler d1 migrations apply postvyn-restore-check --local \
  --config wrangler.restore-check.jsonc          # expect: No migrations to apply!

# 5. Clean up: delete wrangler.restore-check.jsonc — a scratch database is not a backup.
```

**Verification transcript, 2026-11-17** (local D1, after `pnpm db:migrate:local` +
`pnpm db:seed:local`):

| Check | Source | Restored |
|---|---|---|
| export file | 17,122 bytes, 19 `CREATE TABLE` statements incl. `d1_migrations` | — |
| rows | 1 workspace · 2 brands · 0 posts · 0 variants · 0 jobs · 20 migrations | identical |
| schema | 20 `sqlite_master` tables · 49 indexes · `media` 11 columns · `jobs` 12 columns | identical |
| migrations apply | — | `✅ No migrations to apply!` |

The point of the last row: because the export carries `d1_migrations`, the restored database knows
what has already run. Not restorable: the R2 objects. Media rows keep their keys, but the bucket is
not in the export.

**→ If you restore the export into the real database** it will collide on existing rows. Restore
into a scratch, compare, and only then decide — which is the whole point of the drill.

**→ If you import with `--no-data` or through a SQLite CLI**, the file may be a schema-only dump;
check the `INSERT` count before you trust it. `wrangler d1 export` defaults to schema **and** data.

### 5.3 Restoring into production

Same file, a scratch remote database instead of a local one:

```bash
pnpm exec wrangler d1 create postvyn-restore-check     # once: a scratch database, never the prod one
pnpm exec wrangler d1 execute postvyn-restore-check --remote --file=../postvyn-backup.sql
```

**→ If you point production's `database_id` at a restored copy without checking first**, every
post published after the export's timestamp is missing, and the approvals that reference them are
gone with them (the variant hash no longer matches anything). Compare the counts in §5.2 first.

**→ Never put `TOKEN_ENCRYPTION_KEY` in the backup bucket.** The export contains ciphertext for every
channel; the ciphertext without the key is worthless to an attacker, and the key beside it is a
credential dump.

---

## 6. What does not exist yet

Written down so the next person does not look for it at midnight:

| Missing | Consequence today | Workaround |
|---|---|---|
| `/api/v1/admin/jobs/:id/retry` (in the ITA's v1 admin surface, not built) | requeue is a SQL statement | §3.3 |
| `/api/v1/admin/channels/:id/reauth`, `/api/v1/admin/publishing` | no route to clear a channel or flip a switch | §2.1 for the channel, §3.4 for the switches |
| A caller for `rotateCredentials` | the key rotation is reconnect-every-channel | §2.2 |
| A connect form for Instagram and Threads | the only path is the route with a session cookie | §1.3 |
| A read-back route for `uncertain` posts | an uncertain post stays in `review` | check the account, do not re-send, record it in the week's numbers |

Everything above is a gap in the app, not a gap in this document. When one is built, delete its row
here and put the command in the section that owns it.
