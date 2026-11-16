/**
 * The only module that touches the D1 binding.
 *
 * It is not exported for general use: application code goes through `repository.ts`, and the ESLint
 * boundary rule fails any import of `@/db/client` from outside `src/db`. That rule is the
 * replacement for the row-level security D1 does not have (ADR-014) — one door, and a guard on it.
 *
 * The `Bindings` type lives in `./bindings` so callers can *name* the environment without importing
 * this module. A type is not a handle.
 */
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "./bindings";
import * as authSchema from "./auth-schema";
import * as schema from "./schema";

export type { Bindings };

/** One schema object for both families of tables, so a batch can span an auth row and a domain row. */
export const fullSchema = { ...schema, ...authSchema };

export type Database = ReturnType<typeof createDb>;

/**
 * One client per request, never a module-level singleton: a Worker instance can outlive the binding
 * it was created with, and a captured binding is a dead binding.
 */
export function createDb(binding: Bindings["DB"]) {
  return drizzle(binding, { schema: fullSchema });
}
