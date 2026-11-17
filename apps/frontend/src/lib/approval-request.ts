/**
 * The approve endpoints' slot rule, shared.
 *
 * Both approve routes take a slot and both must refuse one that has already passed: an approval
 * without a future time is a decision nobody can schedule. Two copies of that rule is how the single
 * and the batch endpoint end up disagreeing about what "in the future" means.
 */
import { z } from "zod";

/** Unix milliseconds. A string date is accepted too, because a curl call is a real client. */
export const slotAtSchema = z.union([z.number().int().positive(), z.string().min(8)]);

/** Milliseconds, or `null` when the value is unparseable or already past. */
export function parseSlotAt(value: number | string): number | null {
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) && ms > Date.now() ? ms : null;
}
