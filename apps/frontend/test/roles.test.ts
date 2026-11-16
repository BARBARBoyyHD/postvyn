/**
 * The role matrix, tested as a matrix.
 *
 * Two things are worth proving here and nowhere else: the matrix covers every action a mutating
 * route may name, and an action nobody registered fails closed instead of defaulting to allow.
 */
import { describe, expect, it } from "vitest";
import { ACTION_MATRIX, assertCan, can, minimumRole, type Action } from "@/lib/roles";
import type { Role, WorkspaceContext } from "@/lib/context";

const ctx = (role: Role): WorkspaceContext => ({
  workspaceId: "ws-1",
  userId: "user-1",
  role,
});

describe("the matrix says what it should", () => {
  it("keeps the human gate off editors", () => {
    expect(can(ctx("editor"), "variant.approve")).toBe(false);
    expect(can(ctx("editor"), "variant.publish")).toBe(false);
    expect(can(ctx("owner"), "variant.approve")).toBe(true);
    expect(can(ctx("owner"), "variant.publish")).toBe(true);
  });

  it("lets editors write content", () => {
    expect(can(ctx("editor"), "post.create")).toBe(true);
    expect(can(ctx("editor"), "post.update")).toBe(true);
    expect(can(ctx("editor"), "brand.create")).toBe(true);
  });

  it("keeps viewers read-only", () => {
    const writes = Object.keys(ACTION_MATRIX) as Action[];
    for (const action of writes) {
      expect(can(ctx("viewer"), action), `viewer should not be able to ${action}`).toBe(false);
    }
  });

  it("reserves destructive and tenancy actions for owners", () => {
    expect(minimumRole("post.delete")).toBe("owner");
    expect(minimumRole("workspace.member.manage")).toBe("owner");
    expect(minimumRole("channel.connect")).toBe("owner");
  });

  it("covers every action with a role", () => {
    for (const [action, role] of Object.entries(ACTION_MATRIX)) {
      expect(["owner", "editor", "viewer"], action).toContain(role);
    }
  });
});

describe("unknown actions fail closed", () => {
  it("returns no minimum role for an action nobody registered", () => {
    expect(minimumRole("post.explode" as Action)).toBeNull();
  });

  it("denies an owner for an unregistered action", () => {
    expect(can(ctx("owner"), "post.explode" as Action)).toBe(false);
  });

  it("throws from assertCan rather than passing", () => {
    expect(() => assertCan(ctx("owner"), "post.explode" as Action)).toThrow(/may not perform/);
  });
});

describe("assertCan gives the caller a 403-shaped error", () => {
  it("names the action and the role, so the response is diagnosable", () => {
    try {
      assertCan(ctx("viewer"), "post.create");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).name).toBe("ForbiddenError");
      expect((error as Error).message).toContain("post.create");
      expect((error as Error).message).toContain("viewer");
    }
  });
});
