/**
 * The brand payload — one shape, two doors.
 *
 * `/api/v1/brands` validates with these and `brand-form.tsx` validates with the same objects, so a slug
 * the form accepts is a slug the handler accepts. Two copies would drift the day one gains a rule.
 *
 * `slug` is absent from the patch on purpose: it names the brand's vault folder and its public
 * identity, and the update endpoint has never accepted a rename.
 */
import { z } from "zod";

/**
 * Theme tokens are the brand's own palette, exactly as `brands/<slug>/brand.json` records it:
 * `accent` plus two background plates. `plate` is accepted as an alias for `bg0` so an older kit
 * still validates.
 */
export const colorBlock = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  bg0: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  bg1: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  plate: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const voiceBlock = z.object({
  tone: z.string().max(400),
  banned: z.array(z.string().max(60)).max(40).optional(),
});

export const createBrandSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and single hyphens"),
  name: z.string().min(1).max(80),
  handle: z.string().max(60).optional(),
  voice: voiceBlock.optional(),
  colors: colorBlock.optional(),
});

/**
 * The update takes a narrower colour block than creation — accent and a plate, nothing else. That is
 * the endpoint's shape, not an oversight here: sending `bg0`/`bg1` would be silently stripped and the
 * brand's stored plates lost, so the edit form does not offer colours at all.
 */
export const patchBrandSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    handle: z.string().max(60).nullable().optional(),
    voice: voiceBlock.optional(),
    colors: z
      .object({
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        plate: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty patch" });

export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type PatchBrandInput = z.infer<typeof patchBrandSchema>;
