---
title: Postvyn — vault dashboard
type: dashboard
updated: 2026-11-17
tags: [postvyn, home]
---

# 🗂️ Postvyn

> [!info] This repo is a vault
> Open the folder as a vault (vault root = repo root), so specs, journal and code share one graph.
> `apps/frontend` is the project: M0–M5 are applied through their code tasks, M6 (media + cutover) has
> its code and its runbook in place and is waiting on a week of live posts.

## Now

| | |
|---|---|
| **Milestone** | `M5 — Shipping` **30/31** applied (code tasks done; close-out 8.2 descoped 2026-11-17 — X left the lineup, so there is no first live X post) · `M6 — Cutover` **24/27** (upload/serving/hygiene, runbook, `tools/publish` frozen, lessons vaulted, m2–m4 archived; 5.1/5.4/5.5 blocked on live posts) · `M4` **32/32** archived → [[004-PEP#3. Milestones & Phases\|PEP §3]] |
| **Stories** | 78 tracked (63 user + 15 platform) · 54 Must · **26 ☑ · 28 ◐ · 1 ✕ (US-038, X removed) · 23 ☐** → [[006-USER-STORIES]] |
| **Next action** | implement `platform-swap-youtube` — X is out, YouTube (VOD + Shorts) is in (decision 2026-11-17); then the first live publishes per platform and the M6 cutover week (5.1–5.5) and 5.5's keep-or-delete call on `tools/publish` |
| **Blocked on** | a real week of live posts before M6 5.1/5.4/5.5 can move · `wrangler login` before any deploy, remote migration or an unattended cron (US-029) · first GitHub push (m0 6.5) · domain decision (OI-5) · Resend + Meta credentials → [[005-REQUIREMENTS]]. The only open code tasks are three m1 partials: 3.2 Turnstile production assertion, 6.4 per-role endpoint tests, 7.1 reset/revoke-all audit |
| **Open change** | `platform-swap-youtube` **0/28** (new 2026-11-17, the lineup swap — implement next) · `m0` **40/42** · `m1` **29/35** · `m5` **30/31** · `m6` **24/27** |
| **Specified, not started** | `platform-swap-youtube` — X out, YouTube (VOD + Shorts) in: spec deltas, tasks and the doc amendments are written; specialists implement next. `m6-media-and-cutover` — code is in and the runbook exists; what is left is the cutover week. `m2`/`m3`/`m4` archived 2026-11-17; `m5` stays open but is otherwise complete (8.2 descoped with X) |
| **Applied since** | `m2-vault-import-and-board` **42/42**, `m3-authoring` **30/30**, `m4-approval-and-jobs` **32/32** — archived 2026-11-17 (importer + board, composer + spec engine, approvals + cron + kill switch) · `m5-publishing` **30/31** (channels, IG/Threads/X adapters, TikTok pack, failure email) · `m6` **24/27** (R2 uploads, serving, purge, [[runbook]], lessons vaulted) |

## Specs

| Doc | Question it answers | Version |
|---|---|---|
| [[001-PRD]] | what and why; the scope contract | 0.1 |
| [[003-ITA]] | how: stack, data, security, **20 ADRs** | 0.3 |
| [[004-PEP]] | who/when, phases M0–M6, risks R1–R13 | 0.1 |
| [[005-REQUIREMENTS]] | what must exist before M0 | 0.1 + §13 |
| [[006-USER-STORIES]] | the story tracker; what "done" means | 0.1 |
| [[runbook]] | what to do at 11pm: connect, rotate, recover, re-import, restore | — |

`002` is deliberately missing — no BRD. `runbook` is not a spec: it describes commands that exist in
this repo, and its §6 lists the operations the app does not have yet.

## The shape of the thing

Database **D1** (SQLite) · app **vinext** on Workers · auth **Better Auth** (identity only) · tenancy
**ours**, via a scoped repository → [[003-ITA#10. Architecture Decision Records|the 20 ADRs]].

Three rules that keep coming up because they are the product:

- **Approval is bound to content** — edit after approval voids it (hash mismatch → `409`).
- **A 200 is not success** — every publish is read back from the platform before it counts.
- **TikTok is never automated** — manual pack only, and not for lack of trying.

## Open decisions

| # | Question | Where |
|---|---|---|
| OI-5 | which domain carries the app (`zavron.dev` subdomain?) | [[005-REQUIREMENTS#12. Open items]] |
| OQ-1 | SaaS path: shared audited Meta app vs bring-your-own | [[001-PRD#14. Open Questions]] |

*D1 (X automated or manual?) and OQ-3 (keep X?) closed 2026-11-17 — X was removed from the product
and YouTube (VOD + Shorts) added; resolutions are recorded in [[005-REQUIREMENTS#6. Decisions needed before M0]] and [[001-PRD#14. Open Questions]].*

## Journal

- [[2026-11-15]] — spec set written, stack pivoted to all-Cloudflare

Daily notes land in `journal/` (template: `meta/obsidian-templates/Daily`). Use them for build logs:
what shipped, what broke, what you learned — not standup theatre.

## Bridges

- [Content engine vault — Uwi's Department](file:///D:/uwi/Projetcs/Uwi's-Department/Home.md) — where
  the v0.1 publisher (`tools/publish/`) and the live queue actually run today
- [Second brain — Postvyn](file:///D:/uwi/Projetcs/uwi-wiki/uwi-second-brain/03-Resources/Code/Queue%20Studio.md)
  — distilled lessons flow there, not raw notes
- [[AGENTS|AGENTS.md]] — the engineering standards a coding agent must follow

---
Conventions: [[AGENTS]] · The working reference: `Uwi's-Department/tools/publish/`
