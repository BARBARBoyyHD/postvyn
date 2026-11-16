import type { NextConfig } from "next";

/**
 * Cache Components and Partial Prefetching are OFF by decision — not by oversight.
 *
 *  - docs/003-ITA.md §1 lists them as technical non-goals: vinext's support is partial (its own
 *    compatibility check reports "experimental support; behavior is incomplete").
 *  - `"use cache"` is the surface behind the October 2026 Next.js RCE advisories.
 *  - AGENTS.md: "No Cache Components / `use cache`."
 *
 * `create-next-app` turns both ON by default in Next 16. Re-enabling them is a PRD change, not a
 * config tweak.
 *
 * No `turbopack.root` override here on purpose. This app is a **standalone** project: its pnpm store
 * lives at `./node_modules/.pnpm`, inside the directory Turbopack already uses as its filesystem
 * root. The override only becomes necessary in a workspace, where pnpm puts the store above the app
 * and Turbopack refuses to follow symlinks past its root. If this ever moves back into a monorepo,
 * that error returns — and the fix is `turbopack: { root: <workspace root> }`, never a hoisted linker.
 */
const nextConfig: NextConfig = {
  cacheComponents: false,
  partialPrefetching: false,

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
