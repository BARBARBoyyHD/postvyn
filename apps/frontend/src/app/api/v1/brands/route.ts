/**
 * `GET /api/v1/brands` · `POST /api/v1/brands`
 *
 * Both go through the resolved context: the workspace comes from the session, and `createBrand`
 * reads the tenant from that context, never from the body. A `workspaceId` in the payload is ignored
 * by construction — there is no parameter to pass it through.
 */
import { z } from "zod";
import { resolveContext } from "@/auth/context";
import { repository } from "@/db/repository";
import { created, fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * Theme tokens are the brand's own palette, exactly as `brands/<slug>/brand.json` records it:
 * `accent` plus two background plates. `plate` is accepted as an alias for `bg0` so an older kit
 * still validates.
 */
const colorBlock = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  bg0: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  bg1: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  plate: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const voiceBlock = z.object({
  tone: z.string().max(400),
  banned: z.array(z.string().max(60)).max(40).optional(),
});

const createBrandSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and single hyphens"),
  name: z.string().min(1).max(80),
  handle: z.string().max(60).optional(),
  voice: voiceBlock.optional(),
  colors: colorBlock.optional(),
});

export async function GET(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  try {
    const brands = await repository(env).listBrands(resolved.ctx);
    // `voice` is stored as JSON text; an API that hands back a JSON string makes every client parse it.
    // A row that is not JSON (hand-written, older) reads as a tone-only shape rather than crashing.
    return ok({
      brands: brands.map((brand) => ({
        ...brand,
        voice: parseVoice(brand.voice),
        colors: parseColors(brand.colors),
      })),
      activeBrandId: resolved.activeBrandId,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const body = await request.json().catch(() => null);
  const parsed = createBrandSchema.safeParse(body);
  if (!parsed.success) {
    // 422 before any write: validation is not an exception, it is the contract.
    return fail(422, "invalid_brand", parsed.error.flatten());
  }

  try {
    assertCan(resolved.ctx, "brand.create");
    const repo = repository(env);
    const brand = await repo.createBrand(resolved.ctx, parsed.data);
    await repo.recordActivity(resolved.ctx, {
      action: "brand.created",
      detail: { brandId: brand.id, slug: brand.slug },
    });
    return created(brand);
  } catch (error) {
    return toErrorResponse(error);
  }
}

function parseVoice(raw: string | null): { tone: string; banned: string[] } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { tone?: unknown; banned?: unknown };
    const tone = typeof parsed.tone === "string" ? parsed.tone : "";
    const banned = Array.isArray(parsed.banned) ? parsed.banned.filter((item) => typeof item === "string") : [];
    return tone || banned.length ? { tone, banned } : null;
  } catch {
    return { tone: raw, banned: [] };
  }
}

function parseColors(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return null;
  }
}
