/**
 * The publisher port.
 *
 * M4 needed the queue to be real before there was anything to publish to, so the tick takes a
 * publisher as a dependency and the tests inject a double. M5 filled in the adapters behind this same
 * interface — Instagram, Threads, YouTube — including the one that refuses, because TikTok ships as a
 * manual pack.
 *
 * Three methods, and the shape of each is a rule from the spec rather than a convenience:
 *
 *  - `preview()` lists the calls a real publish would make and sends none. It runs the same code
 *    path as `publish()` against a recording transport (design decision 6).
 *  - `publish()` sends. A `published` answer is the *platform's* claim; `verify()` is what makes it
 *    true (design decision 4, non-negotiable 4). The caller must read back before storing success.
 *  - `verify()` reads the post from the platform again, and can be called later on its own.
 *
 * The outcome vocabulary is deliberately small and includes `uncertain`, which is the only honest
 * answer when a request may have succeeded and the response was lost. `failed` carries the platform's
 * own error verbatim, because "publish failed" tells an operator nothing they can act on.
 */
import type { Platform } from "@/lib/specs/platforms";
import { recordingTransport, type HttpCall, type Transport } from "./transport";

/** One media item, already resolved to a URL the platform can fetch without credentials. */
export interface PublishMedia {
  /** The media row id, so a refusal can name the row the operator has to fix. */
  id: string;
  /** The stored object key beside the URL: an unreachable URL is fixed by finding this key. */
  key: string;
  url: string;
  kind: "image" | "video";
  /**
   * The file's own dimensions, from the media row. Only classification reads them (YouTube decides
   * Short vs long-form from the file, not from a field the operator sets), never a URL builder.
   */
  width: number | null;
  height: number | null;
}

export interface PublishInput {
  variantId: string;
  platform: Platform;
  channelId: string;
  /** The platform's own account id — what the confirmation compares against, never the handle. */
  accountRef: string;
  /**
   * The post's title. YouTube's `snippet.title` is the only place a title reaches a platform
   * (design decision 6: variants carry no title field); the other adapters ignore it.
   */
  title: string;
  caption: string;
  hashtags: string[];
  media: PublishMedia[];
  /**
   * Decrypted credentials, in process only. Handed in rather than fetched by the adapter so
   * `src/publishers` never holds a database binding.
   */
  credentials: Readonly<Record<string, string>>;
}

export interface PlatformError {
  /**
   * The platform's own code, verbatim. A refusal made by an adapter *before* the first call carries
   * a lower-case code (`media_required`, `media_unsupported`) so it can be told apart from an answer
   * the platform actually gave.
   */
  code: string;
  /** The platform's own message, verbatim — never paraphrased (spec: publishers §3). */
  message: string;
}

export type PublishResult =
  | { status: "published"; platformPostId: string; permalink: string | null; raw?: unknown }
  | {
      status: "awaiting_platform";
      detail: string;
      /** `containerId` is what the next tick polls; without it a resume would create a second post. */
      resume: { afterMs: number; containerId?: string };
    }
  | { status: "uncertain"; detail: string; platformError?: PlatformError }
  | { status: "failed"; platformError: PlatformError }
  /**
   * The platform refused the *credential*, not the content: expired or revoked. Retrying with the
   * same token cannot work, so the caller flips the channel to `reauth_required` and stops
   * (spec: platform-connections, "An expired token flips the channel").
   */
  | { status: "reauth_required"; platformError: PlatformError }
  | { status: "not_connected"; reason: string };

export interface Preview {
  /** In order: exactly the calls a real publish would make. */
  calls: HttpCall[];
  /** Null when the platform does not charge per post (nothing does today). */
  estimatedCostUsd: number | null;
  /**
   * What the operator should know before sending — platform ceilings and costs an adapter can surface
   * but not enforce. YouTube's quota line lives here (design decision 5); empty when there is nothing
   * to say.
   */
  notes: string[];
}

/**
 * What a publish spends from a quota-metered platform, in that platform's own units.
 *
 * The scarce-resource principle (non-negotiable 6) with a new currency: YouTube's Data API meters
 * uploads and reads per day, not money. Shown in the preview and stored with the result under `quota`
 * in `publish_results.raw` — shown, not enforced (no per-workspace counter in v1).
 */
export interface QuotaEstimate {
  /** Uploads this publish initiates, against the daily allocation for them. */
  uploadSlots: number;
  dailyUploadSlots: number;
  /** Read-back calls, against the general bucket. */
  readUnits: number;
  dailyReadUnits: number;
  /** When the allocation resets, in the platform's words. */
  resetsAt: string;
}

export interface Publisher {
  /** `none` only for the stand-in below: a stand-in with a platform name would be a lie in a report. */
  readonly platform: Platform | "none";
  preview(input: PublishInput): Promise<Preview>;
  publish(input: PublishInput): Promise<PublishResult>;
  /**
   * Reads the post back from the platform — or resumes a container it has not finished with.
   *
   * Takes the input as well as the result because a read-back happens in a later request, where the
   * adapter holds nothing: a token is not something an adapter may keep between invocations.
   */
  verify(result: PublishResult, input: PublishInput): Promise<PublishResult>;
  /**
   * What sending this variant costs, from its shape alone — the same number `preview()` shows.
   *
   * Optional because only a metered platform has an answer, and none of them charges money any more.
   * The queue records it with the result, so the estimate the operator saw is the one that was spent.
   */
  estimateCostUsd?(input: PublishInput): number | null;
  /** The quota estimate for a platform that meters uploads rather than money (YouTube). */
  estimateQuota?(input: PublishInput): QuotaEstimate | null;
}

/**
 * What the dry run answers when the flow reaches its first send.
 *
 * `uncertain` rather than a fabricated success: a fake 200 would let an adapter believe it had a
 * container or a media id. Every adapter answers this, so it lives with the vocabulary.
 */
export const DRY_RUN: PublishResult = { status: "uncertain", detail: "a dry run sends nothing" };

/**
 * Google's code for "this project has spent the day's YouTube Data API quota".
 *
 * It is a terminal answer, not weather: every retry is another `videos.insert` or `videos.list` call
 * against a bucket that refills at midnight Pacific Time, so the queue records it and stops
 * (`publish.quota_blocked`). The same reasoning X's 402 earned before it left the lineup.
 */
export const QUOTA_EXCEEDED_CODE = "quotaExceeded";

export function isQuotaProblem(result: { platformError?: PlatformError }): boolean {
  return result.platformError?.code === QUOTA_EXCEEDED_CODE;
}

/**
 * Run an adapter's flow against a transport that records and never sends, and reduce it to a preview.
 *
 * Adapters are written as `(transport) => …, await transport.send(call)…`; this is the wrapper that
 * makes the dry run the same function as the real publish.
 */
export async function previewFlow(
  run: (transport: Transport) => Promise<unknown>,
  notes: string[] = [],
): Promise<Preview> {
  const { transport, calls } = recordingTransport();
  await run(transport);
  return { calls, estimatedCostUsd: null, notes };
}

/**
 * The M4 stand-in: it never touches the network.
 *
 * Saying "not connected" out loud is the point — a stub that pretended to succeed would make the
 * queue's happy path look proven when nothing had been published anywhere.
 */
export function notConnectedPublisher(): Publisher {
  return {
    platform: "none",
    async preview() {
      return { calls: [], estimatedCostUsd: null, notes: [] };
    },
    async publish() {
      return { status: "not_connected", reason: "no platform adapter is configured yet (M5)" };
    },
    async verify(result) {
      return result;
    },
  };
}
