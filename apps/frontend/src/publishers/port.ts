/**
 * The publisher port.
 *
 * M4 needed the queue to be real before there was anything to publish to, so the tick takes a
 * publisher as a dependency and the tests inject a double. M5 fills in the four adapters behind this
 * same interface — including the one that refuses, because TikTok ships as a manual pack.
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
  url: string;
  kind: "image" | "video";
}

export interface PublishInput {
  variantId: string;
  platform: Platform;
  channelId: string;
  /** The platform's own account id — what X signs for and what the confirmation compares against. */
  accountRef: string;
  caption: string;
  hashtags: string[];
  /**
   * Media in publish order, resolved by `src/db/media.ts` (carousel sequence matters). An adapter
   * never builds a URL: Meta fetches the bytes itself, so a guessed path is a post that fails
   * somewhere the operator cannot see.
   */
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
  /** Null when the platform does not charge per post (Instagram and Threads are free). */
  estimatedCostUsd: number | null;
  /**
   * What the operator should know before sending — platform ceilings an adapter can surface but not
   * enforce. Empty when there is nothing to say.
   */
  notes: string[];
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
   * Optional because only a metered platform has an answer: Instagram and Threads are free. The
   * queue records it with the result, so the estimate the operator saw is the one that was spent
   * (spec: publishers §"X's cost is disclosed before it is incurred").
   */
  estimateCostUsd?(input: PublishInput): number | null;
}

/**
 * What the dry run answers when the flow reaches its first send.
 *
 * `uncertain` rather than a fabricated success: a fake 200 would let an adapter believe it had a
 * container or a media id. Every adapter answers this, so it lives with the vocabulary.
 */
export const DRY_RUN: PublishResult = { status: "uncertain", detail: "a dry run sends nothing" };

/**
 * HTTP 402 from a metered platform: the account is out of prepaid credits.
 *
 * It is a spending problem, not a transient one — retrying with no credits buys nothing, and a
 * backoff that treats it as weather would retry three times before saying so
 * (`docs/003-ITA.md` §7: "402 → top up credits, not retryable").
 */
export const PAYMENT_REQUIRED_CODE = "402";

export function isCostProblem(result: { platformError?: PlatformError }): boolean {
  return result.platformError?.code === PAYMENT_REQUIRED_CODE;
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
