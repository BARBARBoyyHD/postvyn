/**
 * `PATCH /api/v1/brands/:id`
 *
 * A brand in another workspace is `404`, not `403`: telling the caller "it exists but is not yours"
 * leaks the existence of other tenants' data.
 */
import { z } from "zod";
import { resolveContext } from "@/auth/context";
import { repository } from "@/db/repository";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    handle: z.string().max(60).nullable().optional(),
    voice: z
      .object({
        tone: z.string().max(400),
        banned: z.array(z.string().max(60)).max(40).optional(),
      })
      .optional(),
    colors: z
      .object({
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        plate: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty patch" });

export async function PATCH(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return fail(422, "invalid_brand_patch", parsed.error.flatten());

  try {
    assertCan(resolved.ctx, "brand.update");
    const { id } = await params.params;
    const repo = repository(env);
    const brand = await repo.updateBrand(resolved.ctx, id, parsed.data);
    if (!brand) return fail(404, "not_found");

    await repo.recordActivity(resolved.ctx, {
      action: "brand.updated",
      detail: { brandId: brand.id, fields: Object.keys(parsed.data) },
    });
    return ok(brand);
  } catch (error) {
    return toErrorResponse(error);
  }
}
