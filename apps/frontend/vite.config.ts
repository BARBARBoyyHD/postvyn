import { defineConfig } from "vite";
import vinext from "vinext";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";

/**
 * The Workers build path (ADR-016). `next dev` still works alongside this — `pnpm dev` is Next,
 * `pnpm dev:vinext` is Vite — so a vinext regression never blocks a working dev loop.
 *
 * Tailwind runs through its own Vite plugin rather than Next's turbopack loader rule: `vinext check`
 * reports that turbopack `rules` (loaders) are ignored, so CSS would silently ship unstyled. That is
 * the limit of a compatibility scanner — it can say a rule is ignored, not what the rule was for.
 */
export default defineConfig({
  plugins: [
    tailwindcss(),
    vinext({
      images: { optimizer: imagesOptimizer() },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
