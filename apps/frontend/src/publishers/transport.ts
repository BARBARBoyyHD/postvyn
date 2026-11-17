/**
 * The network, as a dependency.
 *
 * Every adapter is written against a `Transport` rather than against `fetch`, for one reason: a dry run
 * is the same code with the network removed (design decision 6). Two implementations of "what would be
 * sent" drift the moment an adapter changes; one implementation with a different transport cannot.
 *
 * `src/publishers` is the only layer allowed to reach a platform API, and this is the only place in it
 * that touches `fetch`.
 */
export interface HttpCall {
  method: "GET" | "POST" | "DELETE";
  url: string;
  /** Header **names** are shown in a preview; values are not, because a token lives in some of them. */
  headers?: Record<string, string>;
  body?: string;
}

export type TransportReply =
  | { kind: "response"; status: number; body: string }
  /** The dry-run transport: the call is recorded and the flow stops at the first send. */
  | { kind: "dry_run" };

export interface Transport {
  send(call: HttpCall): Promise<TransportReply>;
}

export function liveTransport(fetchImpl: typeof fetch = fetch): Transport {
  return {
    async send(call) {
      const response = await fetchImpl(call.url, {
        method: call.method,
        headers: call.headers,
        body: call.body,
      });
      return { kind: "response", status: response.status, body: await response.text() };
    },
  };
}

/**
 * The dry run. It records what would have been sent and never opens a socket.
 *
 * It replies `dry_run` rather than a fabricated success: a fake 200 would let the adapter believe it
 * had a container id and list calls that depend on one. Stopping at the first send keeps every listed
 * call a call the real path would actually make.
 */
export function recordingTransport(): { transport: Transport; calls: HttpCall[] } {
  const calls: HttpCall[] = [];
  return {
    calls,
    transport: {
      async send(call) {
        calls.push(call);
        return { kind: "dry_run" };
      },
    },
  };
}
