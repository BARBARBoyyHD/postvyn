/**
 * `GET /api/v1/channels` · `POST` · `DELETE` — connect and disconnect accounts.
 *
 * The one thing this route cannot do is leak a token. `POST` takes credentials, hands them to the
 * store, and answers with the channel's label and state; every other read goes through the repository,
 * which does not select `channel_credentials` at all. The tests scan the response bodies for the
 * plaintext and for the ciphertext, because "we don't return it" is a property, not a comment.
 *
 * Owner-only, from the role matrix (`channel.connect` / `channel.disconnect`): connecting an account
 * is taking responsibility for where a brand's posts appear.
 */
import { z } from "zod";

import { resolveContext } from "@/auth/context";
import { credentialStore } from "@/db/credentials";
import { repository } from "@/db/repository";
import { created, fail, ok, toErrorResponse } from "@/lib/api";
import { getBindings } from "@/lib/bindings";
import type { WorkerEnv } from "@/lib/env";
import { assertCan } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * A bag of named credentials, not a fixed shape: X needs four values (OAuth 1.0a), Instagram three,
 * Threads three. Naming them per platform here would duplicate what the adapters already know.
 */
const credentialsSchema = z
  .record(z.string().min(1).max(60), z.string().min(1).max(4096))
  .refine((bag) => Object.keys(bag).length > 0 && Object.keys(bag).length <= 20, {
    message: "between 1 and 20 named credentials",
  });

const connectSchema = z.object({
  brandId: z.string().min(1),
  platform: z.enum(["instagram", "threads", "x", "tiktok"]),
  /** The platform's own account id, never the handle — handles change, ids do not. */
  accountRef: z.string().min(1).max(200),
  label: z.string().min(1).max(80).optional(),
  credentials: credentialsSchema,
});

export async function GET(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  try {
    return ok({ channels: await repository(env).listChannels(resolved.ctx) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const parsed = connectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(422, "invalid_channel", parsed.error.flatten());

  try {
    assertCan(resolved.ctx, "channel.connect");

    const result = await credentialStore(env).connect(resolved.ctx, parsed.data);
    if (!result.ok) {
      if (result.reason === "brand_not_found") return fail(404, "not_found");
      // Named `503` with the variable in the message: an operator who cannot connect a channel should
      // not have to read the source to learn which secret is missing.
      return fail(503, "token_key_unavailable", { message: result.message });
    }

    const repo = repository(env);
    await repo.recordActivity(resolved.ctx, {
      action: "channel.connected",
      detail: { channelId: result.channelId, platform: parsed.data.platform, reconnected: !result.created },
    });

    const channel = await repo.getChannelById(resolved.ctx, result.channelId);
    return result.created ? created(channel) : ok(channel);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Disconnect: the credential row goes, the channel stays `disabled`.
 *
 * Deleting the channel would cascade its variants and their publish history — revoking access is not
 * erasing what was published.
 */
export async function DELETE(request: Request) {
  const env = (await getBindings()) as WorkerEnv | null;
  if (!env?.DB) return fail(503, "no_database_binding");

  const resolved = await resolveContext(request, env);
  if (!resolved) return fail(401, "unauthenticated");

  const channelId = new URL(request.url).searchParams.get("id");
  if (!channelId) return fail(422, "missing_channel_id");

  try {
    assertCan(resolved.ctx, "channel.disconnect");

    const store = credentialStore(env);
    const removed = await store.disconnect(resolved.ctx, channelId);
    if (!removed) return fail(404, "not_found");

    const repo = repository(env);
    await repo.recordActivity(resolved.ctx, {
      action: "channel.disconnected",
      detail: { channelId },
    });

    return ok({ channelId, status: "disabled" });
  } catch (error) {
    return toErrorResponse(error);
  }
}
