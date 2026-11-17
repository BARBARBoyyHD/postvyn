---
title: Postvyn — vault dashboard
type: dashboard
updated: 2026-11-17
tags: [postvyn, home]
---

# 🗂️ Postvyn

> [!info] This repo is a vault
> Open the folder `D:/project/nextjs/postvyn` as a vault. Vault root = repo root, so specs,
> journal and code share one graph. `apps/` is still empty — M0 has not started.

## Now

| | |
|---|---|
| **Milestone** | `M3 — Authoring` **17/30** applied · `M2` **38/42** · `M1` **25/35** → [[004-PEP#3. Milestones & Phases\|PEP §3]] |
| **Stories** | 73 tracked (58 user + 15 platform) · 49 Must · **18 ☑ · 23 ◐** → [[006-USER-STORIES]] |
| **Next action** | finish M3's editor (autosave, overrides, media picker) then M4 approval + job queue |
| **Blocked on** | `wrangler login` before any deploy or remote migration · domain decision (OI-5) · Resend + Meta credentials → [[005-REQUIREMENTS]] |
| **Open change** | `m0` **40/42** · `m1` **29/35** · `m2` **41/42** · `m3` **29/30** · `agent-intake` **28/28** |
| **Specified, not started** | `m3-authoring` 8 req · `m4-approval-and-jobs` 9 req · `m5-publishing` 9 req · `m6-media-and-cutover` 6 req — 32 req / 76 scenarios / 120 tasks |
| **Applied since** | `m3-authoring` **17/30** (spec engine live) · `agent-intake` **24/28** (upload + token + draft, end to end) |

## Specs

| Doc | Question it answers | Version |
|---|---|---|
| [[001-PRD]] | what and why; the scope contract | 0.1 |
| [[003-ITA]] | how: stack, data, security, **20 ADRs** | 0.3 |
| [[004-PEP]] | who/when, phases M0–M6, risks R1–R13 | 0.1 |
| [[005-REQUIREMENTS]] | what must exist before M0 | 0.1 + §13 |
| [[006-USER-STORIES]] | the story tracker; what "done" means | 0.1 |

`002` is deliberately missing — no BRD.

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
| D1 | X automated or manual? | [[005-REQUIREMENTS#6. Decisions needed before M0]] |
| OQ-1 | SaaS path: shared audited Meta app vs bring-your-own | [[001-PRD#14. Open Questions]] |
| OQ-3 | keep X at $0.20/link-post, or demote to manual like TikTok | [[001-PRD#14. Open Questions]] |

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
