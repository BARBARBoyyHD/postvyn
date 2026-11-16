/**
 * The board read model, tested where it can actually break.
 *
 * Three claims matter: another brand's posts never appear, the counts agree with the filtered set,
 * and the query count does not grow with the page — that last one is why the board can run on the
 * free plan at all.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { repository } from "@/db/repository";
import type { WorkspaceContext } from "@/lib/context";

const WS = "ws-board";
const BRAND_A = "brand-a";
const BRAND_B = "brand-b";

const ctx: WorkspaceContext = { workspaceId: WS, userId: "user-a", role: "owner" };
const repo = repository(env as unknown as { DB: typeof env.DB });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("delete from variants"),
    env.DB.prepare("delete from posts"),
    env.DB.prepare("delete from channels"),
    env.DB.prepare("delete from brands"),
    env.DB.prepare("delete from memberships"),
    env.DB.prepare("delete from workspaces"),
  ]);

  await env.DB.batch([
    env.DB.prepare("insert into workspaces (id, name) values (?, ?)").bind(WS, "Board WS"),
    env.DB.prepare("insert into brands (id, workspace_id, slug, name) values (?, ?, ?, ?)").bind(
      BRAND_A,
      WS,
      "alpha",
      "Alpha",
    ),
    env.DB.prepare("insert into brands (id, workspace_id, slug, name) values (?, ?, ?, ?)").bind(
      BRAND_B,
      WS,
      "beta",
      "Beta",
    ),
    env.DB.prepare(
      "insert into channels (id, brand_id, platform, account_ref) values (?, ?, ?, ?)",
    ).bind("chan-a", BRAND_A, "instagram", "ig-a"),
    env.DB.prepare(
      "insert into channels (id, brand_id, platform, account_ref) values (?, ?, ?, ?)",
    ).bind("chan-b", BRAND_B, "instagram", "ig-b"),
  ]);
});

async function seedPosts(brandId: string, statuses: string[], prefix: string) {
  const statements = statuses.map((status, i) =>
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status, pillar) values (?, ?, ?, ?, ?, ?, ?)",
    ).bind(`${prefix}-${i}`, WS, brandId, `${prefix} ${i}`, "single", status, i % 2 ? "data" : "story"),
  );
  await env.DB.batch(statements);
}

describe("the board is scoped to one brand", () => {
  it("returns only the requested brand's posts", async () => {
    await seedPosts(BRAND_A, ["review", "review"], "a");
    await seedPosts(BRAND_B, ["review"], "b");

    const board = await repo.listBoard(ctx, { brandId: BRAND_A });
    expect(board.posts.map((p) => p.id).sort()).toEqual(["a-0", "a-1"]);
    expect(Object.values(board.counts)).toEqual([2]);
  });

  it("counts agree with the posts returned", async () => {
    await seedPosts(BRAND_A, ["review", "approved", "approved"], "a");
    const board = await repo.listBoard(ctx, { brandId: BRAND_A });

    expect(board.counts.review).toBe(1);
    expect(board.counts.approved).toBe(2);
    expect(Object.values(board.counts).reduce((a, b) => a + b, 0)).toBe(board.posts.length);
  });

  it("returns an empty board for a brand that is not in this workspace", async () => {
    await seedPosts(BRAND_A, ["review"], "a");
    const board = await repo.listBoard(ctx, { brandId: "brand-somewhere-else" });
    expect(board.posts).toEqual([]);
    expect(board.counts).toEqual({});
  });
});

describe("filters compose", () => {
  it("narrows by pillar and keeps counts consistent", async () => {
    await seedPosts(BRAND_A, ["review", "review", "review", "review"], "a"); // pillars alternate
    const board = await repo.listBoard(ctx, { brandId: BRAND_A, pillar: "data" });
    expect(board.posts.every((p) => p.pillar === "data")).toBe(true);
    expect(board.counts.review).toBe(board.posts.length);
  });
});

describe("pagination is a stable cursor", () => {
  it("walks the whole board without repeating or skipping", async () => {
    await seedPosts(BRAND_A, ["review", "review", "review", "review", "review"], "a");

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const board = await repo.listBoard(ctx, { brandId: BRAND_A, limit: 2, cursor });
      seen.push(...board.posts.map((p) => p.id));
      cursor = board.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("survives a row being inserted mid-walk", async () => {
    await seedPosts(BRAND_A, ["review", "review", "review"], "a");
    const first = await repo.listBoard(ctx, { brandId: BRAND_A, limit: 2 });

    await seedPosts(BRAND_A, ["review"], "z");

    const second = await repo.listBoard(ctx, {
      brandId: BRAND_A,
      limit: 2,
      cursor: first.nextCursor,
    });

    // Nothing from the first page reappears; the new row is a legitimate part of the set.
    const overlap = second.posts.filter((p) => first.posts.some((q) => q.id === p.id));
    expect(overlap).toEqual([]);
  });
});

describe("the query count does not grow with the page", () => {
  it("issues a constant number of statements for a full page", async () => {
    await seedPosts(BRAND_A, Array.from({ length: 20 }, () => "review"), "a");

    let statements = 0;
    const counting = {
      DB: new Proxy(env.DB as unknown as Record<string, unknown>, {
        get(target, prop) {
          if (prop === "prepare" || prop === "batch") statements += 1;
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as unknown as typeof env.DB,
    };

    const counted = repository(counting as unknown as { DB: typeof env.DB });
    const board = await counted.listBoard(ctx, { brandId: BRAND_A, limit: 20 });

    expect(board.posts).toHaveLength(20);
    // counts + page + variants = 3, asserted rather than reviewed.
    expect(statements).toBe(3);
  });
});
