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
}

export interface RecordedReply {
  /** A JSON fixture with one key, `replies`, so a scenario reads as a sequence rather than a blob. */
  replies: FixtureReply[];
}

export function fixtureTransport(fixture: RecordedReply): {
  transport: Transport;
  calls: HttpCall[];
} {
  const calls: HttpCall[] = [];
  let index = 0;

  return {
    calls,
    transport: {
      async send(call) {
        calls.push(call);
        const reply = fixture.replies[index] ?? fixture.replies[fixture.replies.length - 1];
        index += 1;
        if (!reply) return { kind: "dry_run" };
        return { kind: "response", status: reply.status, body: JSON.stringify(reply.body) };
      },
    },
  };
}
