/**
 * A transport that answers from recorded platform replies.
 *
 * Adapters take a `Transport`, so this is the whole network a test needs: the replies live in
 * `test/fixtures/<platform>/*.json` — captured from the platform's documentation and error tables, not
 * invented in the test body — and every call the adapter makes is recorded for assertion.
 *
 * A test must never reach a platform (AGENTS: "recorded fixtures only"), and nothing here can.
 */
import type { HttpCall, Transport } from "@/publishers/transport";

export interface FixtureReply {
  status: number;
  body: unknown;
  /**
   * Headers the adapter reads, lower-cased as `liveTransport` delivers them: `location` carries a
   * resumable upload's session URL, `range` says how many bytes a 308 has, `content-length` sizes the
   * media a HEAD probes.
   */
  headers?: Record<string, string | undefined>;
}

/**
 * Bytes an adapter fetched itself. A download is either literally recorded (`bytes`, as text so a
 * fixture stays reviewable in a diff) or described by the file's total size alone (`sizeBytes`), sliced
 * per request — a fixture does not need to carry 11 MB of video to prove three segments.
 */
export type FixtureDownload =
  | { status: number; bytes: string }
  | { status: number; sizeBytes: number };

export interface RecordedReply {
  /** A JSON fixture with one key, `replies`, so a scenario reads as a sequence rather than a blob. */
  replies: FixtureReply[];
  /** Consumed in order by `transport.download`, independently of `replies`. */
  downloads?: FixtureDownload[];
}

export function fixtureTransport(fixture: RecordedReply): {
  transport: Transport;
  calls: HttpCall[];
} {
  const calls: HttpCall[] = [];
  let index = 0;
  let downloadIndex = 0;

  return {
    calls,
    transport: {
      async send(call) {
        calls.push(call);
        const reply = fixture.replies[index] ?? fixture.replies[fixture.replies.length - 1];
        index += 1;
        if (!reply) return { kind: "dry_run" };
        return {
          kind: "response",
          status: reply.status,
          body: JSON.stringify(reply.body),
          ...(reply.headers ? { headers: defined(reply.headers) } : {}),
        };
      },
      async download(url, range) {
        calls.push({ method: "GET", url });
        const download =
          fixture.downloads?.[downloadIndex] ?? fixture.downloads?.[fixture.downloads.length - 1];
        downloadIndex += 1;
        if (!download) return { kind: "dry_run" };
        const bytes =
          "sizeBytes" in download
            ? // A ranged request gets the slice it asked for, so a chunked upload's offsets advance the
              // way they would against R2 — the bytes themselves are zeroes, only their count matters.
              new Uint8Array(
                range
                  ? Math.max(0, Math.min(range.length, download.sizeBytes - range.offset))
                  : download.sizeBytes,
              )
            : new TextEncoder().encode(download.bytes);
        return { kind: "bytes", status: download.status, bytes };
      },
    },
  };
}

/**
 * A JSON fixture gives every key an optional `| undefined` when its replies disagree about which
 * headers they carry, so the undefined ones are dropped before they reach a `Record<string, string>`.
 */
function defined(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
