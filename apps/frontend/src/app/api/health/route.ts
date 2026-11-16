import { NextResponse } from "next/server";
import { getBindings } from "@/lib/bindings";

/**
 * Unversioned on purpose: this is infrastructure, not product surface. A load balancer or a monitor
 * should be able to call it without knowing which API version is deployed.
 *
 * It reports D1 reachability because "the Worker answered" and "the Worker can talk to its database"
 * are different failures, and confusing them wastes the first ten minutes of every incident.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const bindings = await getBindings();

  if (!bindings?.DB) {
    // next dev has no Worker and no D1. Not an error — just a runtime without a database.
    return NextResponse.json(
      { ok: true, runtime: "node", d1: "unavailable" },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const row = await bindings.DB.prepare("select 1 as one").first<{ one: number }>();
    return NextResponse.json(
      { ok: row?.one === 1, runtime: "workers", d1: "ok" },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, runtime: "workers", d1: "error", error: (error as Error).message },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
