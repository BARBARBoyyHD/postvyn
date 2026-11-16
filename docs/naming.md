# Naming — Postvyn (2026-11-16)

Availability verified by RDAP (`rdap.org`) on 2026-11-16. **Point in time** — re-check before
registering, because squatters watch new-gTLD trends.

| Candidate | .dev | .app | .com | .id / .co.id | Name conflict |
|---|---|---|---|---|---|
| **queuewright** | free | free | taken | free / free | none found |
| **outtray** | free | taken | taken | free / free | none found |
| outboxed | free | free | taken | not checked | **Outboxed Design & Development Ltd** (UK, 2015, `outboxed.net`) |
| postdeck | free | taken | taken | not checked | **live product "PostDeck"** — multi-platform posting planner |
| prepress | free | taken | taken | not checked | **category word** (Esko, CloudLab, OnPrintShop) — unownable |
| postworks | free | free? | taken | not checked | Postworks (NYC film lab) — unverified but likely |
| outqueue | free | taken | taken | not checked | not checked |
| queuepost | free | — | — | — | not checked |
| boardpost | free | — | — | — | not checked |
| deckpost | free | — | — | — | not checked |
| queuekit | free | taken | taken | free / — | not checked |

Rejected earlier for domain exhaustion: outbox, hopper, chute, sluice, manifest, preflight, posthaste,
waypost, outpost, postern, postroom, copydesk, imprimatur, signet, mailroom, draftroom, outflow,
shipdesk, queuehouse, postline, postflow, postcraft, sendstack, poststack, readyroom, postflight,
postpipe, sendoff — every one taken on `.dev`.

## Decision: Postvyn

`Postvyn` — POST-vin. Verified 2026-11-16: **every relevant TLD is free**, and an exact-match web
search returns nothing at all. That combination is rare enough to act on rather than keep shopping.

| | |
|---|---|
| `.com` · `.dev` · `.app` | free |
| `.id` · `.co.id` | free |
| `.io` · `.xyz` | free |
| Exact-name collisions | none found (empty search result set) |

Why it works: it opens with the thing the product does (**post**), carries an invented tail that can be
owned (**vyn**), and it is short enough to type from memory. Same construction as Zavron — a real root
plus a coined ending — so it reads as a Zavron product without borrowing the parent's name.

Known trade-offs, accepted:

- **Pronunciation needs settling once**: POST-vin, not post-vine. Fix it in the wordmark and say it in
  the README; do not leave it to chance.
- **"vyn" is a modern-startup spelling.** That is what makes it ownable — the plain "postvin" would be
  forgettable and probably contested.
- **It starts with "post"**, so generic searches collide with Postman, Postiz and Postpone. The exact
  token is clear; only category searches are crowded.
- **Zero prior use cuts both ways**: nothing to fight, nothing to inherit.
- **Free names on coined words are perishable.** Seven free TLDs will not stay free once the site is
  indexed. Register the `.com` and `.dev` first, same day.

## Earlier recommendation (superseded)

**Queuewright** — owned `.dev`, `.app`, `.id`, `.co.id` with no collision, and had the craft
association ("wright" = maker). Superseded on the operator's call: Postvyn is easier to remember.

**Outtray** — kept the outbox idea; duller, and only `.dev` + `.id` were free.

## Next steps

1. Register `postvyn.com` and `postvyn.dev` today; add `.app` and `.id` if the budget allows.
2. Rename in the repo — `package.json` name, `wrangler.jsonc` worker name, D1/R2 names in docs and
   commands, `openspec` change text — then re-run every gate.
3. Only after that create the real Cloudflare resources: renaming a live D1 means a second database.
4. DJKI check on the wordmark before printing anything.
