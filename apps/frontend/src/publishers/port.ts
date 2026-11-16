/**
 * The publisher port.
 *
 * M4 needs the queue to be real before there is anything to publish to, so the tick takes a publisher as
 * a dependency and the tests inject a stub. M5 fills in the four real adapters behind this same
 * interface — including the one that refuses, because TikTok ships as a manual pack.
 *
 * The outcome vocabulary is deliberately small and includes `uncertain`, which is the only honest answer
 * when a request may have succeeded and the response was lost.
 */
export interface PublishInput {
  variantId: string;
  platform: string;
  caption: string;
  hashtags: string[];
  mediaIds: string[];
  channelId: string;
}

export type PublishOutcome =
  | { state: "published"; platformPostId: string; url: string | null; raw?: unknown }
  | { state: "awaiting_platform"; reason: string; resumeAfterMs: number }
  | { state: "failed"; error: string; ambiguous?: boolean }
  | { state: "not_connected"; reason: string };

export interface Publisher {
  readonly platform: string;
  publish(input: PublishInput): Promise<PublishOutcome>;
}

/**
 * The M4 stand-in: it never touches the network.
 *
 * Saying "not connected" out loud is the point — a stub that pretended to succeed would make the queue's
 * happy path look proven when nothing had been published anywhere.
 */
export function notConnectedPublisher(): Publisher {
  return {
    platform: "none",
    async publish() {
      return { state: "not_connected", reason: "no platform adapter is configured yet (M5)" };
    },
  };
}
