/**
 * What an upload can be refused for, and the HTTP answer each refusal gets.
 *
 * One vocabulary for four doors (the browser and the agent token, minting and recording): the message
 * is written where the rule lives, and the status is decided here once — a second mapping is how the
 * same refusal becomes `415` at one door and `422` at the other, and the client starts guessing.
 *
 * The request schemas live here too, for the same reason: both doors accept the same body, so a rule
 * added to one has to be a rule at the other.
 */
import { z } from "zod";

export type UploadRefusalCode =
  | "empty_file"
  | "too_large"
  | "unsupported_type"
  | "storage_unconfigured"
  | "upload_missing"
  | "type_mismatch"
  | "dimensions_mismatch";

export type UploadRefusal = { ok: false; code: UploadRefusalCode; message: string };

/**
 * What a client may ask to upload: the file's own claim, used to size the URL and name the key. Every
 * field is checked again against the bytes at record time — this schema only keeps nonsense out.
 * `postable` describes the recorded row, so it belongs to the record body, not here.
 */
export const mintUploadSchema = z.object({
  filename: z.string().trim().min(1).max(200).default("upload"),
  mime: z.string().trim().min(1).max(80),
  bytes: z.number().int().nonnegative(),
});

/** What a client may claim about the object it just uploaded. Dimensions are compared, never stored. */
export const recordUploadSchema = z
  .object({
    mime: z.string().trim().min(1).max(80),
    width: z.number().int().positive().nullish(),
    height: z.number().int().positive().nullish(),
    postable: z.boolean().optional(),
  })
  .refine((value) => (value.width == null) === (value.height == null), {
    message: "width and height are declared together, or not at all",
  });

/** The `:id` a mint handed out. Constrained so it can never name a path. */
export const uploadIdSchema = z.string().regex(/^upl_[0-9a-f]{8,32}$/, "not an upload id");

export function uploadRefusalStatus(code: UploadRefusalCode): 413 | 415 | 422 | 503 {
  switch (code) {
    case "too_large":
      return 413;
    case "unsupported_type":
      return 415;
    case "storage_unconfigured":
      return 503;
    case "empty_file":
    case "upload_missing":
    case "type_mismatch":
    case "dimensions_mismatch":
      return 422;
    default: {
      const never: never = code;
      throw new Error(`no status for upload refusal ${String(never)}`);
    }
  }
}
