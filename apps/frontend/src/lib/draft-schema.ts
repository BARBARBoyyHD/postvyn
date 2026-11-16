/**
 * The draft payload — one shape, two doors.
 *
 * The UI sends this and the agent sends this, so a script that works with a token also documents what
 * the file picker produces. Nothing in the shape can name a workspace or a role: the scope comes from
 * whoever authenticated.
 */
import { z } from "zod";

export const draftSchema = z.object({
  title: z.string().trim().min(3).max(160),
  format: z.string().trim().min(1).max(40).default("single"),
  pillar: z.string().trim().max(40).nullish(),
  targets: z
    .array(
      z.object({
        /** Exact channel, or a platform name — "tiktok" is what a caller actually knows. */
        channelId: z.string().min(1).optional(),
        platform: z.string().min(1).max(40).optional(),
        caption: z.string().max(20_000).default(""),
        hashtags: z.array(z.string().trim().min(1).max(80)).max(60).default([]),
        mediaIds: z.array(z.string().min(1)).max(60).default([]),
      }),
    )
    .min(1)
    .max(12)
    .refine(
      (targets) => targets.every((target) => Boolean(target.channelId) !== Boolean(target.platform)),
      "each target needs exactly one of channelId or platform",
    ),
});

export type DraftInput = z.infer<typeof draftSchema>;
