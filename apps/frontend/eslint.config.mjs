import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vite/Workers build output and local runtime state — lint the source, not the bundle.
    "dist/**",
    ".wrangler/**",
    "worker-configuration.d.ts",
  ]),

  /**
   * The tenancy boundary (ADR-014), enforced.
   *
   * D1 has no row-level security, so "every query is scoped to a workspace" is a property of the
   * code, not of the database. `src/db` is the only place allowed to hold the D1 binding; everything
   * else must go through the repository, which demands a `WorkspaceContext`.
   *
   * This rule is the second line of defence — the isolation test is the first. Both exist because a
   * comment saying "don't do this" does not fail CI.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db/client", "@/db/client/*", "**/db/client", "**/db/client/*"],
              message:
                "The D1 client is confined to src/db (ADR-014). Use the repository, which takes a WorkspaceContext — see src/db/repository.ts.",
            },
            {
              group: ["drizzle-orm", "drizzle-orm/*"],
              message:
                "Query building belongs inside src/db/repository.ts, where the workspace filter is injected. Inside src/db this is allowed; everywhere else use a repository function.",
            },
          ],
        },
      ],
    },
  },
  /**
   * Auth is the one module allowed to hold the D1 client, and for a specific reason: Better Auth's
   * adapter issues its own queries against its own four tables (`user`, `session`, `account`,
   * `verification`), none of which belong to a workspace. There is no tenant to scope by, so routing
   * them through the repository would be a lie. The rule that still applies: no `drizzle-orm` imports
   * here — query building stays inside `src/db`.
   */
  {
    files: ["src/auth/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["drizzle-orm", "drizzle-orm/*"],
              message:
                "Query building belongs in src/db. Auth may construct the adapter client, but not write queries with it.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
