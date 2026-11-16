"use client";

/**
 * The brand switcher.
 *
 * The active brand is a cookie, not a database row: it is a view preference, and a preference that
 * needs a round trip to change is a preference nobody changes. Setting it and refreshing re-renders the
 * server components with the new brand — no client-side data layer, no stale cache to invalidate.
 *
 * It changes **content surfaces only**. The chrome stays Zavron (design decision 8).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const COOKIE = "postvyn.brand";

export function BrandSwitcher({
  brands,
  activeBrandId,
}: {
  brands: { id: string; slug: string; name: string; colors: string | null }[];
  activeBrandId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(activeBrandId ?? brands[0]?.id ?? "");

  if (brands.length === 0) {
    return (
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
        no brands yet
      </span>
    );
  }

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    setCurrent(id);
    // 30 days, path-wide: a view preference should survive a laptop restart.
    document.cookie = `${COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  const active = brands.find((brand) => brand.id === current);
  const accent = active?.colors ? safeAccent(active.colors) : null;

  return (
    <label className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zavron-muted">brand</span>
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: accent ?? "var(--color-zavron-accent)" }}
      />
      <select
        value={current}
        onChange={onChange}
        disabled={pending}
        aria-label="Active brand"
        className="rounded-md border border-zavron-line bg-zavron-bg1/70 px-2 py-1.5 text-sm text-zavron-ink focus:border-zavron-accent focus:outline-none disabled:opacity-60"
      >
        {brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Reads `{accent}` from the stored JSON without trusting it. */
function safeAccent(colors: string): string | null {
  try {
    const parsed = JSON.parse(colors) as { accent?: unknown };
    return typeof parsed.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(parsed.accent)
      ? parsed.accent
      : null;
  } catch {
    return null;
  }
}
