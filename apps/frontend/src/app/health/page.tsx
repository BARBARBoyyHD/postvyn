/**
 * Human status page.
 *
 * `/api/health` answers a monitor in one word (and stays JSON). This page answers a person: what is
 * deployed, can it reach its database, is the schema applied, and are the secrets present — without
 * ever printing a secret value.
 *
 * `force-dynamic` because a status page that is cached is a lie.
 */
import Link from "next/link";
import { getBindings } from "@/lib/bindings";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Status",
  description: "Live status of the Postvyn Worker, its database and its schema.",
};

type State = "ok" | "warn" | "fail";

interface Check {
  name: string;
  state: State;
  detail: string;
}

const DOT: Record<State, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  fail: "bg-rose-500",
};

const LABEL: Record<State, string> = { ok: "OK", warn: "WARN", fail: "FAIL" };

async function collectChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const env = await getBindings();

  if (!env) {
    checks.push({
      name: "Runtime",
      state: "warn",
      detail: "Node runtime — no Worker bindings. Expected under `next dev`; not a failure.",
    });
    checks.push({
      name: "Database",
      state: "warn",
      detail: "No D1 binding available outside the Worker. Run `pnpm dev:vinext` to test for real.",
    });
    return checks;
  }

  checks.push({ name: "Runtime", state: "ok", detail: "Cloudflare Workers (workerd)" });

  // ── D1 reachability, timed ────────────────────────────────────────────────────────────────────
  const started = Date.now();
  try {
    const row = await env.DB.prepare("select 1 as one").first<{ one: number }>();
    const ms = Date.now() - started;
    checks.push({
      name: "Database",
      state: row?.one === 1 ? "ok" : "fail",
      detail: row?.one === 1 ? `D1 responded in ${ms} ms` : "D1 answered, but not with the value asked for",
    });
  } catch (error) {
    checks.push({
      name: "Database",
      state: "fail",
      detail: `D1 unreachable: ${(error as Error).message}`,
    });
    return checks;
  }

  // ── storage: proves the R2 binding resolves, without writing anything ───────────────────────
  // M6 owns media uploads; this only answers "is the bucket reachable from this Worker". A `head`
  // on a key that does not exist is the cheapest honest probe — class B operation, no writes.
  try {
    const probe = await env.MEDIA?.head("__postvyn_healthcheck__");
    checks.push({
      name: "Storage",
      state: env.MEDIA ? "ok" : "warn",
      detail: env.MEDIA
        ? `R2 binding resolves · probe ${probe === null ? "returned null, as expected for a missing key" : "found an object (unexpected)"}`
        : "No MEDIA binding — media uploads will fail in M6",
    });
  } catch (error) {
    checks.push({
      name: "Storage",
      state: "warn",
      detail: `R2 binding present but unreachable: ${(error as Error).message}`,
    });
  }

  // ── schema applied ───────────────────────────────────────────────────────────────────────────
  try {
    const applied = await env.DB.prepare(
      "select name from d1_migrations order by id desc limit 3",
    ).all<{ name: string }>();
    const total = await env.DB.prepare("select count(*) as n from d1_migrations").first<{ n: number }>();
    const names = applied.results?.map((r) => r.name) ?? [];
    checks.push({
      name: "Schema",
      state: names.length > 0 ? "ok" : "warn",
      detail:
        names.length > 0
          ? `${total?.n ?? 0} migrations applied · latest: ${names[0]}`
          : "No migrations applied yet — run `pnpm db:migrate:local`",
    });
  } catch {
    checks.push({
      name: "Schema",
      state: "warn",
      detail: "d1_migrations is missing — this database has never been migrated",
    });
  }

  // ── content counts: proves the tables exist *and* are readable ──────────────────────────────
  try {
    const counts = await env.DB.prepare(
      `select
         (select count(*) from workspaces) as workspaces,
         (select count(*) from brands)     as brands,
         (select count(*) from posts)      as posts,
         (select count(*) from variants)   as variants`,
    ).first<{ workspaces: number; brands: number; posts: number; variants: number }>();

    checks.push({
      name: "Content",
      state: "ok",
      detail: `${counts?.workspaces ?? 0} workspace(s) · ${counts?.brands ?? 0} brands · ${counts?.posts ?? 0} posts · ${counts?.variants ?? 0} variants`,
    });
  } catch (error) {
    checks.push({
      name: "Content",
      state: "fail",
      detail: `Tables unreadable: ${(error as Error).message}`,
    });
  }

  // ── publishing switch (ADR-019) ─────────────────────────────────────────────────────────────
  const publishingOn = env.PUBLISHING_ENABLED === "true";
  checks.push({
    name: "Publishing",
    state: publishingOn ? "ok" : "warn",
    detail: publishingOn
      ? "Kill switch is ON — jobs may be claimed"
      : "Kill switch is OFF — nothing will publish, queued jobs wait",
  });

  // ── configuration, presence only ────────────────────────────────────────────────────────────
  const configured: { key: string; present: boolean; why: string }[] = [
    { key: "BETTER_AUTH_SECRET", present: Boolean(env.BETTER_AUTH_SECRET), why: "sessions" },
    { key: "RESEND_API_KEY", present: Boolean(env.RESEND_API_KEY), why: "email" },
    { key: "TOKEN_ENCRYPTION_KEY", present: Boolean(env.TOKEN_ENCRYPTION_KEY), why: "channel tokens" },
  ];
  const missing = configured.filter((c) => !c.present);

  checks.push({
    name: "Configuration",
    state: missing.length === 0 ? "ok" : "warn",
    detail:
      missing.length === 0
        ? "All required secrets are present"
        : `Not set: ${missing.map((m) => `${m.key} (${m.why})`).join(", ")}`,
  });

  return checks;
}

export default async function HealthPage() {
  const checks = await collectChecks();
  const worst: State = checks.some((c) => c.state === "fail")
    ? "fail"
    : checks.some((c) => c.state === "warn")
      ? "warn"
      : "ok";

  const headline =
    worst === "ok" ? "All systems nominal" : worst === "warn" ? "Running, with caveats" : "Something is broken";

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-zavron-line/70">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight text-zavron-ink">
            Postvyn<span className="text-zavron-accent">.</span>
          </Link>
          <Link href="/" className="text-sm text-zavron-muted hover:text-zavron-ink">
            ← Back
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zavron-muted">Status</p>
        <h1 className="mt-4 flex items-center gap-3 text-3xl font-semibold tracking-tight text-zavron-ink">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[worst]}`} aria-hidden />
          {headline}
        </h1>
        <p className="mt-3 text-sm text-zavron-muted">
          Checked at {new Date().toISOString()} · machine-readable copy at{" "}
          <a href="/api/health" className="text-zavron-ink underline decoration-zavron-line underline-offset-4">
            /api/health
          </a>
        </p>

        <ul className="mt-10 divide-y divide-zavron-line/60 border-y border-zavron-line/60">
          {checks.map((check) => (
            <li key={check.name} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-6">
              <span className="flex w-40 shrink-0 items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${DOT[check.state]}`} aria-hidden />
                <span className="text-sm font-medium text-zavron-ink">{check.name}</span>
              </span>
              <span className="font-mono text-[11px] uppercase tracking-wider text-zavron-muted">
                {LABEL[check.state]}
              </span>
              <span className="text-sm text-zavron-muted sm:flex-1">{check.detail}</span>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-xs leading-relaxed text-zavron-muted">
          Secrets are reported as present or absent, never by value. A status page that prints a key is
          a status page that leaks it.
        </p>
      </main>
    </div>
  );
}
