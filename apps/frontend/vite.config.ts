import { defineConfig } from "vite";
import vinext from "vinext";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";

/**
 * The Workers build path (ADR-016). `pnpm dev` is this server — the only one that carries bindings
 * (D1/R2), so it is the only one where auth and the board work. `pnpm dev:next` is plain Next, kept
 * as a fallback when a vinext regression blocks the loop; it has no bindings, and every route that
 * needs D1 answers 503 there.
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
