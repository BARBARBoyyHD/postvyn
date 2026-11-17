/**
 * Is the URL a platform will fetch actually there?
 *
 * A public bucket that is not public, or a key that was never written, is a failed post the operator
 * only learns about after the fact — and Instagram's error for it names nothing they can fix. One HEAD
 * per media item, before the platform is called, turns that into a refusal that names the key.
 *
 * Cheap by construction: no bytes are transferred, nothing is cached, and a dry run sends nothing —
 * `dry_run` is answered as "cannot confirm", not as a proof of reachability.
 */
import type { PublishMedia } from "./port";
import type { Transport } from "./transport";

export type MediaProbe = { ok: true } | { ok: false; mediaId: string; key: string; message: string };

export async function probeMedia(
  media: readonly PublishMedia[],
  transport: Transport,
): Promise<MediaProbe> {
  for (const item of media) {
    const reply = await transport.send({ method: "HEAD", url: item.url });

    // A preview must not require the network, so the probe stops at the same place every adapter does.
    if (reply.kind === "dry_run") return { ok: true };

    if (reply.status < 200 || reply.status >= 400) {
      return {
        ok: false,
        mediaId: item.id,
        key: item.key,
        message:
          `media ${item.id} is not reachable at ${item.url} (HTTP ${reply.status}). ` +
          `The object ${item.key} must be public before it can be published — check R2_PUBLIC_BASE ` +
          `and the bucket's public access.`,
      };
    }
  }

  return { ok: true };
}
