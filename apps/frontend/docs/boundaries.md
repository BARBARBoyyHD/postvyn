# The tenancy boundary (and how to prove it still holds)

D1 has no row-level security. That is a **downgrade** from the original design, recorded as such in
ADR-014 — so tenant isolation here is a property of the code, defended three ways. This note exists so
the defence is verifiable by someone who has never read the code.

## 1. One door

`src/db/client.ts` is the only module that receives the D1 binding. It is not exported for general
use: application code calls `repository(env)` and gets functions that each demand a `WorkspaceContext`.

```
route handler ──▶ repository(env).listPosts(ctx) ──▶ db.select()…where(workspace_id = ctx.workspaceId)
```

The caller never supplies a workspace id. `ctxFromSession()` builds the context from the resolved
session, and a workspace id in a request body is ignored — that is the whole point.

## 2. The lint rule fires

`eslint.config.mjs` restricts `@/db/client` and `drizzle-orm` to `src/db/**`. Prove it in ten seconds:

```bash
printf 'import { createDb } from "@/db/client";\nexport const probe = createDb;\n' > src/lib/boundary-probe.ts
pnpm lint            # expected: error, no-restricted-imports
rm src/lib/boundary-probe.ts
```

Expected output (captured from a real run):

```
src/lib/boundary-probe.ts
  1:1  error  '@/db/client' import is restricted from being used by a pattern.
              The D1 client is confined to src/db (ADR-014). Use the repository, which takes a
              WorkspaceContext — see src/db/repository.ts    no-restricted-imports
```

A *type* import is fine — that is why the `Bindings` interface lives in `src/db/bindings.ts` and not
in `client.ts`. Possessing the shape of the environment is harmless; possessing the client is not.

## 3. The isolation test fails when the boundary breaks

`pnpm test` runs 13 tests in real `workerd` against real D1. The negative control is not theoretical —
it was executed:

```bash
# remove the workspace predicate from getPostById in src/db/repository.ts, then:
pnpm test
```

Result (real run):

```
× does not return B's post to A
Test Files  1 failed (1)
     Tests  1 failed | 12 passed (13)
```

Exactly one test failed — the one that walks straight at the boundary with another tenant's primary
key. That is the difference between a suite that asserts something and a suite that looks like it does.

## What is still weaker than RLS

A forgotten `where` clause is a code-review failure, not an impossibility. The three defences above
make it loud, but they do not make it impossible — unlike a database policy, which cannot be bypassed
by an application bug. That sentence is the honest version, and it is why the test is mandatory rather
than nice-to-have.
