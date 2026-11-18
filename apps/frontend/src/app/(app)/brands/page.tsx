/**
 * Brands: the voice and palette a channel publishes under.
 *
 * Read-only for viewers; editors and owners get the form. `?edit=<id>` chooses the brand the form
 * edits instead of keeping a second copy of the list in a client component — the page stays the
 * composer, and a reload lands on the same state.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentRequest } from "@/auth/current";
import { BrandForm, type BrandFormBrand } from "@/components/brand-form";
import { repository } from "@/db/repository";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  const { env, resolved } = await currentRequest();
  if (!env || !resolved) redirect("/sign-in");

  const brands = await repository(env).listBrands(resolved.ctx);
  const editable = can(resolved.ctx, "brand.create");
  const requested = (await searchParams).edit;
  const editing =
    (typeof requested === "string" ? brands.find((brand) => brand.id === requested) : undefined) ?? null;
  const active = brands.find((brand) => brand.id === resolved.activeBrandId);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link
        href="/board"
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted transition-colors hover:text-zavron-ink"
      >
        ← board
      </Link>

      <h1 className="mt-5 text-2xl font-medium tracking-tight text-zavron-ink">Brands</h1>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
        {brands.length} brand{brands.length === 1 ? "" : "s"} · active: {active?.name ?? "none"}
      </p>

      <section className="mt-7">
        <h2 className="border-b border-zavron-line pb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
          In this workspace
        </h2>

        {brands.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-zavron-line p-6 text-sm text-zavron-muted">
            No brands yet. A brand is the voice and palette its channels publish under — the first one
            goes below.
          </p>
        ) : (
          <ul className="mt-3 space-y-1">
            {brands.map((brand) => {
              const voice = readVoice(brand.voice);
              const colors = readColors(brand.colors);
              return (
                <li
                  key={brand.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-zavron-line bg-zavron-bg1/40 px-3 py-2"
                >
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 self-center rounded-full border border-zavron-line"
                    style={{ backgroundColor: colors.accent ?? "transparent" }}
                  />
                  <span className="text-sm text-zavron-ink">{brand.name}</span>
                  <span className="font-mono text-[10px] text-zavron-muted">{brand.slug}</span>
                  {brand.handle ? (
                    <span className="font-mono text-[10px] text-zavron-muted">{brand.handle}</span>
                  ) : null}
                  {voice.tone ? (
                    <span className="max-w-[18rem] truncate text-xs text-zavron-muted" title={voice.tone}>
                      {voice.tone}
                    </span>
                  ) : null}
                  <span className="ml-auto flex items-baseline gap-3">
                    {brand.id === resolved.activeBrandId ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-brand-accent">
                        active
                      </span>
                    ) : null}
                    {editable ? (
                      <Link
                        href={`/brands?edit=${brand.id}`}
                        aria-label={`edit ${brand.name}`}
                        className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted underline decoration-zavron-line underline-offset-4 transition-colors hover:text-zavron-ink"
                      >
                        edit
                      </Link>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editable ? (
        <section className="mt-8">
          <h2 className="border-b border-zavron-line pb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
            {editing ? `Edit · ${editing.name}` : "New brand"}
          </h2>

          {editing ? (
            <BrandForm key={editing.id} mode="edit" brand={toFormBrand(editing)} />
          ) : (
            <BrandForm key="new" mode="create" />
          )}

          {editing ? (
            <Link
              href="/brands"
              className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted hover:text-zavron-ink"
            >
              cancel edit
            </Link>
          ) : null}
        </section>
      ) : (
        <p className="mt-8 text-sm leading-relaxed text-zavron-muted">
          Only editors and owners can change brands.
        </p>
      )}
    </main>
  );
}

/** The row's stored JSON, read defensively — a malformed value is not allowed to blank the page. */
function readVoice(raw: string | null): { tone: string; banned: string[] } {
  if (!raw) return { tone: "", banned: [] };
  try {
    const parsed = JSON.parse(raw) as { tone?: unknown; banned?: unknown };
    return {
      tone: typeof parsed.tone === "string" ? parsed.tone : "",
      banned: Array.isArray(parsed.banned)
        ? parsed.banned.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return { tone: raw, banned: [] };
  }
}

/** Accent plus the two plates, each only if it is a hex colour. */
function readColors(raw: string | null): { accent: string | null; bg0: string | null; bg1: string | null } {
  const empty = { accent: null, bg0: null, bg1: null };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const hex = (value: unknown): string | null =>
      typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
    return { accent: hex(parsed.accent), bg0: hex(parsed.bg0), bg1: hex(parsed.bg1) };
  } catch {
    return empty;
  }
}

function toFormBrand(brand: {
  id: string;
  slug: string;
  name: string;
  handle: string | null;
  voice: string | null;
  colors: string | null;
}): BrandFormBrand {
  const voice = readVoice(brand.voice);
  const colors = readColors(brand.colors);
  return {
    id: brand.id,
    slug: brand.slug,
    name: brand.name,
    handle: brand.handle,
    tone: voice.tone,
    banned: voice.banned,
    accent: colors.accent,
    bg0: colors.bg0,
    bg1: colors.bg1,
  };
}
