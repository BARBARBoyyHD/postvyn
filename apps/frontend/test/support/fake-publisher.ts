/**
 * A test double for the publisher port — deliberately not a shipped adapter.
 *
 * It is a two-call platform (create the post, read it back) because that is the minimum shape that
 * exercises the port's two rules: a preview lists exactly those calls, and a success only becomes
 * `published` once it has been read back.
 *
 * The network is injected, so no test using this can reach a host: every "request" is answered by the
 * `fetchImpl` the test passes in, which records calls instead of sending them.
 */
import {
  previewFlow,
  type Preview,
  type Publisher,
  type PublishInput,
  type PublishResult,
} from "@/publishers/port";
import { liveTransport, type Transport } from "@/publishers/transport";
import type { Platform } from "@/lib/specs/platforms";

export interface FakePublisherOptions {
  platform?: Platform;
  /** What `verify()` answers instead of confirming — the read-back-failed case. */
  verifyAnswer?: PublishResult;
  /** The injected network. Tests pass a recorder; nothing here has a default. */
  fetchImpl: typeof fetch;
}

export function fakePublisher(options: FakePublisherOptions): Publisher {
  const platform = options.platform ?? "threads";
  const base = `https://fake.${platform}.test/v1`;

  async function flow(input: PublishInput, transport: Transport): Promise<PublishResult> {
    const created = await transport.send({
      method: "POST",
      url: `${base}/posts`,
      headers: {
        authorization: `Bearer ${input.credentials.accessToken ?? ""}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: input.caption, hashtags: input.hashtags, account: input.accountRef }),
    });

    // The dry run stops at the first send: no fabricated id, so no call that depends on one.
    if (created.kind === "dry_run") {
      return { status: "uncertain", detail: "dry run" };
    }

    if (created.status >= 400) {
      const error = JSON.parse(created.body) as { code: string; message: string };
      return { status: "failed", platformError: { code: error.code, message: error.message } };
    }

    const { id } = JSON.parse(created.body) as { id: string };

    const readBack = await transport.send({ method: "GET", url: `${base}/posts/${id}` });
    if (readBack.kind === "dry_run") {
      return { status: "uncertain", detail: "dry run" };
    }
    if (readBack.status >= 400) {
      return { status: "uncertain", detail: "created, but the read-back failed" };
    }

    const post = JSON.parse(readBack.body) as { id: string; permalink: string };
    return { status: "published", platformPostId: post.id, permalink: post.permalink };
  }

  const transport = liveTransport(options.fetchImpl);

  return {
    platform,
    async preview(input): Promise<Preview> {
      return previewFlow((recording) => flow(input, recording));
    },
    async publish(input): Promise<PublishResult> {
      return flow(input, transport);
    },
    async verify(result): Promise<PublishResult> {
      return options.verifyAnswer ?? result;
    },
  };
}

/** A fetch-shaped recorder: answers from a table of canned responses and keeps what was asked. */
export function recordingFetch(answers: { status: number; body: unknown }[]): {
  fetchImpl: typeof fetch;
  calls: { url: string; method: string; body: string | null }[];
} {
  const calls: { url: string; method: string; body: string | null }[] = [];
  let index = 0;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
    const answer = answers[index] ?? answers[answers.length - 1];
    index += 1;
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;

  return { fetchImpl, calls };
}
