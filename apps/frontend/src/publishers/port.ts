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

export interface PublishInput {
  variantId: string;
  platform: Platform;
  channelId: string;
  /** The platform's own account id — what X signs for and what the confirmation compares against. */
  accountRef: string;
  caption: string;
  hashtags: string[];
  /**
   * Media ids in publish order. M6 turns these into public URLs; an adapter that needs bytes tells
   * the caller so rather than inventing a path.
   */
  mediaIds: string[];
  /**
   * Decrypted credentials, in process only. Handed in rather than fetched by the adapter so
   * `src/publishers` never holds a database binding.
   */
  credentials: Readonly<Record<string, string>>;
}

export interface PlatformError {
  /** The platform's own code, verbatim. */
  code: string;
  /** The platform's own message, verbatim — never paraphrased (spec: publishers §3). */
  message: string;
}

export type PublishResult =
  | { status: "published"; platformPostId: string; permalink: string | null; raw?: unknown }
  | { status: "awaiting_platform"; detail: string; resume: { afterMs: number } }
  | { status: "uncertain"; detail: string; platformError?: PlatformError }
  | { status: "failed"; platformError: PlatformError }
  | { status: "not_connected"; reason: string };

export interface Preview {
  /** In order: exactly the calls a real publish would make. */
  calls: HttpCall[];
  /** Null when the platform does not charge per post (Instagram and Threads are free). */
  estimatedCostUsd: number | null;
}

export interface Publisher {
  /** `none` only for the stand-in below: a stand-in with a platform name would be a lie in a report. */
  readonly platform: Platform | "none";
  preview(input: PublishInput): Promise<Preview>;
  publish(input: PublishInput): Promise<PublishResult>;
  verify(result: PublishResult): Promise<PublishResult>;
}

/**
 * Run an adapter's flow against a transport that records and never sends, and reduce it to a preview.
 *
 * Adapters are written as `(transport) => …, await transport.send(call)…`; this is the wrapper that
 * makes the dry run the same function as the real publish.
 */
export async function previewFlow(run: (transport: Transport) => Promise<unknown>): Promise<Preview> {
  const { transport, calls } = recordingTransport();
  await run(transport);
  return { calls, estimatedCostUsd: null };
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
      return { calls: [], estimatedCostUsd: null };
    },
    async publish() {
      return { status: "not_connected", reason: "no platform adapter is configured yet (M5)" };
    },
    async verify(result) {
      return result;
    },
  };
}
