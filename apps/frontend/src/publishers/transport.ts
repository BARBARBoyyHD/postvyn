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
  /** A binary body. `body` is the text case; a media chunk cannot be a string (X uploads bytes). */
  bodyBytes?: Uint8Array<ArrayBuffer>;
}

export type TransportReply =
  | { kind: "response"; status: number; body: string }
  /** The dry-run transport: the call is recorded and the flow stops at the first send. */
  | { kind: "dry_run" };

export type DownloadReply =
  | { kind: "bytes"; status: number; bytes: Uint8Array<ArrayBuffer> }
  /** The dry run records the URL and never opens a socket. */
  | { kind: "dry_run" };

export interface Transport {
  send(call: HttpCall): Promise<TransportReply>;
  /**
   * Fetch the bytes of media the adapter has to upload itself.
   *
   * Meta fetches a URL; X cannot — it takes the bytes, chunk by chunk. Separate from `send` because
   * an answer is binary here, and a text body would corrupt every video that went through it.
   */
  download(url: string): Promise<DownloadReply>;
}

export function liveTransport(fetchImpl: typeof fetch = fetch): Transport {
  return {
    async send(call) {
      const response = await fetchImpl(call.url, {
        method: call.method,
        headers: call.headers,
        body: call.bodyBytes ?? call.body,
      });
      return { kind: "response", status: response.status, body: await response.text() };
    },
    async download(url) {
      const response = await fetchImpl(url);
      return {
        kind: "bytes",
        status: response.status,
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
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
      async download(url) {
        calls.push({ method: "GET", url });
        return { kind: "dry_run" };
      },
    },
  };
}
