/**
 * The isolation suite: the exit criterion for M0.
 *
 * Two workspaces, each with its own brand, channel and posts. Every repository call is made with
 * workspace A's context and must never see workspace B's rows — including when it is handed B's
 * primary key directly, which is how tenant leaks usually happen.
 *
 * These run in real `workerd` against real D1, so what is verified is the SQL, not a mock's opinion
 * of it.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { repository } from "@/db/repository";
import { systemContext, type WorkspaceContext } from "@/lib/context";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

const BRAND_A = "aaaaaaaa-1111-4111-8111-000000000001";
const BRAND_B = "bbbbbbbb-2222-4222-8222-000000000002";

const CHANNEL_A = "aaaaaaaa-1111-4111-8111-0000000000c1";
const CHANNEL_B = "bbbbbbbb-2222-4222-8222-0000000000c2";

const POST_A = "aaaaaaaa-1111-4111-8111-0000000000f1";
const POST_B = "bbbbbbbb-2222-4222-8222-0000000000f2";

const ctxA: WorkspaceContext = { workspaceId: WS_A, userId: "user-a", role: "owner" };
const ctxB: WorkspaceContext = { workspaceId: WS_B, userId: "user-b", role: "owner" };

const repo = repository(env as unknown as { DB: typeof env.DB });

beforeEach(async () => {
  // Explicit deletes rather than a fresh database: singleWorker reuses one D1 for the whole run.
  await env.DB.batch([
    env.DB.prepare("delete from activity_log"),
    env.DB.prepare("delete from publish_results"),
    env.DB.prepare("delete from approvals"),
    env.DB.prepare("delete from variants"),
    env.DB.prepare("delete from posts"),
    env.DB.prepare("delete from media"),
    env.DB.prepare("delete from channel_credentials"),
    env.DB.prepare("delete from channels"),
    env.DB.prepare("delete from brands"),
    env.DB.prepare("delete from memberships"),
    env.DB.prepare("delete from workspaces"),
  ]);

  await env.DB.batch([
    env.DB.prepare("insert into workspaces (id, name) values (?, ?)").bind(WS_A, "Workspace A"),
    env.DB.prepare("insert into workspaces (id, name) values (?, ?)").bind(WS_B, "Workspace B"),

    env.DB.prepare("insert into brands (id, workspace_id, slug, name) values (?, ?, ?, ?)").bind(
      BRAND_A,
      WS_A,
      "alpha",
      "Brand A",
    ),
    env.DB.prepare("insert into brands (id, workspace_id, slug, name) values (?, ?, ?, ?)").bind(
      BRAND_B,
      WS_B,
      "beta",
      "Brand B",
    ),

    env.DB.prepare(
      "insert into channels (id, brand_id, platform, account_ref) values (?, ?, ?, ?)",
    ).bind(CHANNEL_A, BRAND_A, "instagram", "ig-a"),
    env.DB.prepare(
      "insert into channels (id, brand_id, platform, account_ref) values (?, ?, ?, ?)",
    ).bind(CHANNEL_B, BRAND_B, "instagram", "ig-b"),

    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format) values (?, ?, ?, ?, ?)",
    ).bind(POST_A, WS_A, BRAND_A, "Post in A", "single"),
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format) values (?, ?, ?, ?, ?)",
    ).bind(POST_B, WS_B, BRAND_B, "Post in B", "single"),
  ]);
});

describe("listing is scoped to the context's workspace", () => {
  it("returns only A's posts", async () => {
    const posts = await repo.listPosts(ctxA);
    expect(posts.map((p) => p.id)).toEqual([POST_A]);
  });

  it("returns only B's posts for B's context", async () => {
    const posts = await repo.listPosts(ctxB);
    expect(posts.map((p) => p.id)).toEqual([POST_B]);
  });

  it("returns only A's brands", async () => {
    const brands = await repo.listBrands(ctxA);
    expect(brands.map((b) => b.id)).toEqual([BRAND_A]);
  });

  it("scopes channels through their brand, since channels carry no workspace id", async () => {
    const channels = await repo.listChannels(ctxA);
    expect(channels.map((c) => c.id)).toEqual([CHANNEL_A]);
  });

  it("counts only the context's posts", async () => {
    await expect(repo.countPosts(ctxA)).resolves.toBe(1);
  });
});

describe("a known id from another workspace is treated as absent", () => {
  it("does not return B's post to A", async () => {
    await expect(repo.getPostById(ctxA, POST_B)).resolves.toBeNull();
  });

  it("does not return B's brand to A", async () => {
    await expect(repo.getBrandById(ctxA, BRAND_B)).resolves.toBeNull();
  });

  it("does not return B's channel to A", async () => {
    await expect(repo.getChannelById(ctxA, CHANNEL_B)).resolves.toBeNull();
  });

  it("still returns the row to its own workspace", async () => {
    await expect(repo.getPostById(ctxB, POST_B)).resolves.not.toBeNull();
  });
});

describe("the facade refuses to run unscoped", () => {
  it("throws when called without a context", async () => {
    // The type system rejects this; the runtime must too, for untyped callers and `as any` shortcuts.
    await expect(repo.listPosts(undefined as unknown as WorkspaceContext)).rejects.toThrow(
      /WorkspaceContext/,
    );
  });

  it("throws for a context with an empty workspace id", async () => {
    await expect(
      repo.listPosts({ workspaceId: "", userId: null, role: "owner" }),
    ).rejects.toThrow(/WorkspaceContext/);
  });
});

describe("negative control — what the boundary is holding back", () => {
  /**
   * This is the control for the whole suite. It queries WITHOUT the repository, the way a careless
   * handler would, and asserts it sees both tenants. If this test ever returns one row, the seeds
   * are broken and the isolation tests above are proving nothing.
   */
  it("an unscoped query does cross the boundary", async () => {
    const { results } = await env.DB.prepare("select id from posts order by id").all<{
      id: string;
    }>();
    expect(results.map((r: { id: string }) => r.id).sort()).toEqual([POST_A, POST_B].sort());
  });

  it("system work still gets a context, it is not an escape hatch", () => {
    const ctx = systemContext(WS_A);
    expect(ctx.workspaceId).toBe(WS_A);
    expect(ctx.userId).toBeNull();
  });
});
