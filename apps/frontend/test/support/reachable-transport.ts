/**
 * The reachability probe's network, answered.
 *
 * The probe only needs a status (m6 2.3), so this replies with one and records the HEADs it saw. No
 * bytes are transferred, and nothing here can reach a host — same rule as `fixture-transport.ts`.
 */
import type { HttpCall, Transport } from "@/publishers/transport";

export function reachableTransport(status = 200): { transport: Transport; calls: HttpCall[] } {
  const calls: HttpCall[] = [];
  return {
    calls,
    transport: {
      async send(call) {
        calls.push(call);
        return { kind: "response", status, body: "" };
      },
      async download(url) {
        calls.push({ method: "GET", url });
        return { kind: "bytes", status, bytes: new Uint8Array() };
      },
    },
  };
}
