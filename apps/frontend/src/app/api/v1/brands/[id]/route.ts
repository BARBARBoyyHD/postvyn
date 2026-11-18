/**
 * `PATCH /api/v1/brands/:id`
 *
 * A brand in another workspace is `404`, not `403`: telling the caller "it exists but is not yours"
 * leaks the existence of other tenants' data.
 */
import { resolveContext } from "@/auth/context";
import { repository } from "@/db/repository";
import { fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import { patchBrandSchema } from "@/lib/brand-schema";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, params: { params: Promise<{ id: string }> }) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const body = await request.json().catch(() => null);
  const parsed = patchBrandSchema.safeParse(body);
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
