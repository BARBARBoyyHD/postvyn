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
import type { PlatformError } from "@/publishers/port";
import { liveTransport } from "@/publishers/transport";
import { proveYoutubeConnect } from "@/publishers/youtube-auth";

export const dynamic = "force-dynamic";

/**
 * A bag of named credentials, not a fixed shape: Instagram and Threads each need their own handful of
 * values. YouTube is the exception below, because its three names *are* the contract and a typo in one
 * of them is worth a 422 rather than a failed token mint.
 */
const credentialsSchema = z
  .record(z.string().min(1).max(60), z.string().min(1).max(4096))
  .refine((bag) => Object.keys(bag).length > 0 && Object.keys(bag).length <= 20, {
    message: "between 1 and 20 named credentials",
  });

/**
 * One schema per platform family, discriminated so the router cannot accept a YouTube channel without
 * the three values that mint a token, and cannot accept `x` at all — X left the lineup on 2026-11-17
 * (design decision 7), and a new X row would be a channel nothing can publish to.
 *
 * YouTube carries no `accountRef`: it is read from the authenticated account's own channel
 * (`channels.list?mine=true`) during the connect call, never typed in (platform-connections).
 */
const connectSchema = z.discriminatedUnion("platform", [
  z.object({
    platform: z.literal("youtube"),
    brandId: z.string().min(1),
    label: z.string().min(1).max(80).optional(),
    credentials: z.object({
      clientId: z.string().min(1).max(4096),
      clientSecret: z.string().min(1).max(4096),
      refreshToken: z.string().min(1).max(4096),
    }),
  }),
  z.object({
    platform: z.enum(["instagram", "threads", "tiktok"]),
    brandId: z.string().min(1),
    /** The platform's own account id, never the handle — handles change, ids do not. */
    accountRef: z.string().min(1).max(200),
    label: z.string().min(1).max(80).optional(),
    credentials: credentialsSchema,
  }),
]);

type ConnectInput = {
  brandId: string;
  platform: "instagram" | "threads" | "youtube" | "tiktok";
  accountRef: string;
  label?: string | null;
  credentials: Record<string, string>;
};

/**
 * The parsed body as the store's argument — with YouTube's account id proven first.
 *
 * The store is not asked to reach Google: `src/db` holds the rows, `src/publishers` holds the platform
 * calls, and this is the seam between them (AGENTS: layering).
 */
async function storeInput(
  data: z.infer<typeof connectSchema>,
): Promise<{ ok: true; input: ConnectInput } | { ok: false; platformError: PlatformError }> {
  if (data.platform !== "youtube") return { ok: true, input: data };

  const proven = await proveYoutubeConnect({ credentials: data.credentials, transport: liveTransport() });
  if (!proven.ok) return { ok: false, platformError: proven.platformError };
  return { ok: true, input: { ...data, accountRef: proven.accountRef } };
}

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

    const prepared = await storeInput(parsed.data);
    // Google refused the values, or the account has no YouTube channel: `422` because the operator's
    // input is the problem, with Google's own code beside it.
    if (!prepared.ok) return fail(422, "credentials_rejected", prepared.platformError);

    const result = await credentialStore(env).connect(resolved.ctx, prepared.input);
    if (!result.ok) {
      if (result.reason === "brand_not_found") return fail(404, "not_found");
      // Named `503` with the variable in the message: an operator who cannot connect a channel should
      // not have to read the source to learn which secret is missing.
      return fail(503, "token_key_unavailable", { message: result.message });
    }

    const repo = repository(env);
    await repo.recordActivity(resolved.ctx, {
      action: "channel.connected",
      detail: { channelId: result.channelId, platform: prepared.input.platform, reconnected: !result.created },
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
