"use client";

/**
 * Create or edit one brand.
 *
 * Create carries the colours; edit does not. `PATCH` accepts only `accent`/`plate`, so posting the
 * create-time `bg0`/`bg1` would be stripped by the schema and the stored plates replaced with
 * nothing — a colour field that silently deletes data is worse than a read-only swatch.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ZodError } from "zod";

import { createBrandSchema, patchBrandSchema } from "@/lib/brand-schema";

export interface BrandFormBrand {
  id: string;
  slug: string;
  name: string;
  handle: string | null;
  tone: string;
  banned: string[];
  accent: string | null;
  bg0: string | null;
  bg1: string | null;
}

export type BrandFormProps =
  | { mode: "create" }
  | { mode: "edit"; brand: BrandFormBrand };

interface Fields {
  slug: string;
  name: string;
  handle: string;
  tone: string;
  banned: string;
  accent: string;
  bg0: string;
  bg1: string;
}

const EMPTY: Fields = {
  slug: "",
  name: "",
  handle: "",
  tone: "",
  banned: "",
  accent: "",
  bg0: "",
  bg1: "",
};

const LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted";

function initialFields(brand: BrandFormBrand | null): Fields {
  if (!brand) return EMPTY;
  return {
    slug: brand.slug,
    name: brand.name,
    handle: brand.handle ?? "",
    tone: brand.tone,
    banned: brand.banned.join(", "),
    accent: brand.accent ?? "",
    bg0: brand.bg0 ?? "",
    bg1: brand.bg1 ?? "",
  };
}

export function BrandForm(props: BrandFormProps) {
  const router = useRouter();
  const editing = props.mode === "edit" ? props.brand : null;
  const [fields, setFields] = useState<Fields>(() => initialFields(editing));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Fields>(key: K, value: string) {
    setFields((previous) => ({ ...previous, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(null);

    const payload = buildPayload(fields, editing !== null);
    const checked = editing
      ? patchBrandSchema.safeParse(payload)
      : createBrandSchema.safeParse(payload);
    if (!checked.success) {
      setError(issueLines(checked.error));
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(editing ? `/api/v1/brands/${editing.id}` : "/api/v1/brands", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checked.data),
      });

      if (!response.ok) {
        setError(await failureLine(response));
        return;
      }

      setSaved(editing ? "saved" : `created ${fields.name.trim()}`);
      if (!editing) setFields(EMPTY);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 rounded-xl border border-zavron-line bg-zavron-bg1/40 px-4 py-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {editing ? (
          <label className="flex flex-col gap-1">
            <span className={LABEL}>
              slug <span className="normal-case tracking-normal">(fixed once created)</span>
            </span>
            <span className="font-mono text-[11px] text-zavron-ink">{editing.slug}</span>
          </label>
        ) : (
          <TextField
            label="slug"
            hint="lowercase, single hyphens"
            value={fields.slug}
            onChange={(value) => set("slug", value)}
            required
          />
        )}

        <TextField
          label="name"
          value={fields.name}
          onChange={(value) => set("name", value)}
          required
        />
        <TextField
          label="handle"
          hint="optional"
          value={fields.handle}
          onChange={(value) => set("handle", value)}
        />

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={LABEL}>voice tone</span>
          <textarea
            value={fields.tone}
            onChange={(event) => set("tone", event.target.value)}
            rows={3}
            maxLength={400}
            placeholder="how this brand writes — punctuation, formality, the words it never uses"
            className="rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1.5 text-sm text-zavron-ink placeholder:text-zavron-muted focus:border-zavron-accent focus:outline-none"
          />
        </label>

        <TextField
          label="banned words"
          hint="comma separated"
          value={fields.banned}
          onChange={(value) => set("banned", value)}
        />

        {editing ? <ColorSummary brand={editing} /> : null}
      </div>

      {editing ? null : (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <TextField
            label="accent"
            hint="#rrggbb"
            value={fields.accent}
            onChange={(value) => set("accent", value)}
          />
          <TextField
            label="bg0"
            hint="optional"
            value={fields.bg0}
            onChange={(value) => set("bg0", value)}
          />
          <TextField
            label="bg1"
            hint="optional"
            value={fields.bg1}
            onChange={(value) => set("bg1", value)}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-zavron-accent px-3 py-1.5 text-sm font-medium text-zavron-bg0 disabled:opacity-50"
        >
          {busy ? "saving…" : editing ? "Save changes" : "Create brand"}
        </button>
        <span className="font-mono text-[10px] text-zavron-muted/60">
          {editing ? "slug is fixed · edits are audited" : "the slug becomes the brand's folder name"}
        </span>
      </div>

      {saved ? (
        <p role="status" className="mt-3 font-mono text-[10px] text-[#5eead4]">
          {saved}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 font-mono text-[11px] text-[#f43f5e]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

interface TextFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

function TextField({ label, hint, value, onChange, required = false }: TextFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>
        {label} {hint ? <span className="normal-case tracking-normal">({hint})</span> : null}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        spellCheck={false}
        className="rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1.5 text-sm text-zavron-ink placeholder:text-zavron-muted focus:border-zavron-accent focus:outline-none"
      />
    </label>
  );
}

/** The edit view's colours: shown, not editable — see the file header. */
function ColorSummary({ brand }: { brand: BrandFormBrand }) {
  const tokens: { name: string; value: string | null }[] = [
    { name: "accent", value: brand.accent },
    { name: "bg0", value: brand.bg0 },
    { name: "bg1", value: brand.bg1 },
  ];

  return (
    <div className="flex flex-col gap-1 sm:col-span-2">
      <span className={LABEL}>colours</span>
      <div className="flex flex-wrap items-center gap-4">
        {tokens.map((token) => (
          <span key={token.name} className="flex items-baseline gap-2">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 self-center rounded-full border border-zavron-line"
              style={{ backgroundColor: token.value ?? "transparent" }}
            />
            <span className="font-mono text-[10px] text-zavron-muted">
              {token.name} {token.value ?? "—"}
            </span>
          </span>
        ))}
      </div>
      <span className="font-mono text-[10px] leading-relaxed text-zavron-muted/70">
        set at creation: the update endpoint takes no background plates, so editing only the accent
        would drop them
      </span>
    </div>
  );
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPayload(fields: Fields, editMode: boolean): unknown {
  const voice = { tone: fields.tone.trim(), banned: splitList(fields.banned) };
  if (editMode) return { name: fields.name.trim(), handle: fields.handle.trim() || null, voice };

  return {
    slug: fields.slug.trim(),
    name: fields.name.trim(),
    ...(fields.handle.trim() ? { handle: fields.handle.trim() } : {}),
    ...(voice.tone || voice.banned.length ? { voice } : {}),
    ...(fields.accent.trim()
      ? {
          colors: {
            accent: fields.accent.trim(),
            ...(fields.bg0.trim() ? { bg0: fields.bg0.trim() } : {}),
            ...(fields.bg1.trim() ? { bg1: fields.bg1.trim() } : {}),
          },
        }
      : {}),
  };
}

function issueLines(error: ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "form"}: ${issue.message}`)
    .join(" · ");
}

async function failureLine(response: Response): Promise<string> {
  if (response.status === 401) return "Your session expired. Reload the page and sign in again.";
  if (response.status === 403) return "Only editors and owners can change brands.";
  if (response.status === 404) return "This brand is no longer there — reload the page.";
  if (response.status === 409) return "That slug is taken.";

  const body = asRecord(await response.json().catch(() => ({})));
  if (response.status === 422) return detailLines(body) ?? "The server refused those details.";
  const code = typeof body?.error === "string" ? body.error : null;
  return code ? `The request was refused (${code}).` : `The request failed (${response.status}).`;
}

function detailLines(body: Record<string, unknown> | null): string | null {
  const detail = asRecord(body?.detail);
  const form = stringList(detail?.formErrors);
  const fieldErrors = asRecord(detail?.fieldErrors);
  const fields = fieldErrors
    ? Object.entries(fieldErrors).flatMap(([field, messages]) =>
        stringList(messages).map((message) => `${field}: ${message}`),
      )
    : [];
  const lines = [...form, ...fields];
  return lines.length ? lines.slice(0, 3).join(" · ") : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
