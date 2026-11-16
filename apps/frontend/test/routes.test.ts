/**
 * The public surface, asserted rather than assumed.
 *
 * Every route under `/api/v1` is authenticated. That is easy to state and easy to break — one new
 * handler that forgets `requireContext` and the whole board is readable by anyone who guesses the URL.
 * So the routes are listed here by hand, and each one is called with no session at all.
 *
 * When a route is added, this file is where the omission shows up: the list is the contract.
 */
import { describe, expect, it } from "vitest";

import { GET as getBrands, POST as postBrand } from "@/app/api/v1/brands/route";
import { PATCH as patchBrand } from "@/app/api/v1/brands/[id]/route";
import { GET as getQueue } from "@/app/api/v1/queue/route";
import { GET as getPost } from "@/app/api/v1/posts/[id]/route";

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

const PROTECTED: { name: string; handler: Handler; method: string; path: string }[] = [
  { name: "GET /api/v1/brands", handler: getBrands as Handler, method: "GET", path: "/api/v1/brands" },
  { name: "POST /api/v1/brands", handler: postBrand as Handler, method: "POST", path: "/api/v1/brands" },
  {
    name: "PATCH /api/v1/brands/:id",
    handler: patchBrand as Handler,
    method: "PATCH",
    path: "/api/v1/brands/00000000-0000-4000-8000-000000000002",
  },
  { name: "GET /api/v1/queue", handler: getQueue as Handler, method: "GET", path: "/api/v1/queue" },
  {
    name: "GET /api/v1/posts/:id",
    handler: getPost as Handler,
    method: "GET",
    path: "/api/v1/posts/post_zavron_2026-10-about-zavron",
  },
];

const call = (entry: (typeof PROTECTED)[number]) =>
  entry.handler(
    new Request(`https://postvyn.test${entry.path}`, {
      method: entry.method,
      headers: { "content-type": "application/json" },
      body: entry.method === "GET" ? undefined : "{}",
    }),
    { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000002" }) },
  );

describe("no session, no data", () => {
  for (const entry of PROTECTED) {
    it(`${entry.name} refuses an anonymous caller`, async () => {
      const response = await call(entry);
      expect(response.status).toBe(401);
    });

    it(`${entry.name} answers in the one envelope`, async () => {
      const body = (await (await call(entry)).json()) as { ok?: boolean; error?: string };
      expect(body.ok).toBe(false);
      // failures carry a vocabulary word, not a sentence: the client switches on the code
      expect(typeof body.error).toBe("string");
    });

    it(`${entry.name} does not leak a caption or title in the refusal`, async () => {
      const text = await (await call(entry)).text();
      expect(text).not.toContain("About Zavron");
      expect(text.toLowerCase()).not.toContain("caption\":");
    });
  }
});

/**
 * The two routes that are deliberately open, and why.
 *
 * `/api/health` is for monitors — it reports status, never content, and never a secret by value.
 * `/api/auth/*` is the door itself: requiring a session to sign in would be a closed loop.
 */
describe("the open routes stay open for the reason stated", () => {
  it("health needs no session and reports no secret", async () => {
    const { GET: health } = await import("@/app/api/health/route");
    const response = await health();
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toContain('"ok"');
    for (const secret of ["BETTER_AUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "RESEND_API_KEY"]) {
      expect(text).not.toMatch(new RegExp(`${secret}"\\s*:\\s*"[^"]+"`));
    }
  });
});
