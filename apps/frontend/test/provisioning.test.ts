/**
 * Provisioning: exactly one workspace, exactly one owner membership, written together.
 *
 * This is the test that would have caught "account exists, workspace does not" — the failure that
 * presents to the user as a broken login and to the developer as nothing at all.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { identityStore } from "@/db/identity";
import { repository } from "@/db/repository";
import { systemContext } from "@/lib/context";

const store = identityStore(env as unknown as { DB: typeof env.DB });
const repo = repository(env as unknown as { DB: typeof env.DB });

const USER_A = "user-a";
const USER_B = "user-b";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("delete from activity_log"),
    env.DB.prepare("delete from brands"),
    env.DB.prepare("delete from memberships"),
    env.DB.prepare("delete from workspaces"),
  ]);
});

describe("first sign-up provisions a tenant", () => {
  it("creates one workspace and one owner membership", async () => {
    const membership = await store.ensureWorkspace(USER_A, "Uwi");

    expect(membership.role).toBe("owner");
    expect(membership.workspaceId).toBeTruthy();

    const { results } = await env.DB.prepare(
      "select count(*) as n from memberships where user_id = ?",
    )
      .bind(USER_A)
      .all<{ n: number }>();
    expect(results[0].n).toBe(1);
  });

  it("is idempotent — a second session creates nothing", async () => {
    const first = await store.ensureWorkspace(USER_A, "Uwi");
    const second = await store.ensureWorkspace(USER_A, "Uwi");

    expect(second.workspaceId).toBe(first.workspaceId);

    const { results } = await env.DB.prepare("select count(*) as n from workspaces").all<{
      n: number;
    }>();
    expect(results[0].n).toBe(1);
  });

  it("gives two users separate workspaces", async () => {
    const a = await store.ensureWorkspace(USER_A, "A");
    const b = await store.ensureWorkspace(USER_B, "B");
    expect(a.workspaceId).not.toBe(b.workspaceId);
  });

  it("starts with publishing switched off", async () => {
    const { workspaceId } = await store.ensureWorkspace(USER_A, "Uwi");
    const { results } = await env.DB.prepare(
      "select publishing_enabled from workspaces where id = ?",
    )
      .bind(workspaceId)
      .all<{ publishing_enabled: number }>();
    expect(results[0].publishing_enabled).toBe(0);
  });
});

describe("the provisioned workspace is immediately usable", () => {
  it("resolves a primary membership by user id", async () => {
    const created = await store.ensureWorkspace(USER_A, "Uwi");
    const found = await store.findPrimaryMembership(USER_A);
    expect(found?.workspaceId).toBe(created.workspaceId);
  });

  it("has no brands yet, and that is not an error", async () => {
    const { workspaceId } = await store.ensureWorkspace(USER_A, "Uwi");
    const brands = await repo.listBrands(systemContext(workspaceId));
    expect(brands).toEqual([]);
  });

  it("does not hand one user's workspace to another", async () => {
    const a = await store.ensureWorkspace(USER_A, "A");
    await store.ensureWorkspace(USER_B, "B");
    const found = await store.findPrimaryMembership(USER_A);
    expect(found?.workspaceId).toBe(a.workspaceId);
  });
});
