/**
 * A real publish has to say where it is going, out loud.
 *
 * The error this prevents is the one that reads well in an incident report: a post for brand A's
 * Instagram went to brand B's Threads, because the only thing linking request to destination was an
 * id in a dropdown. The request names every destination it believes it is addressing; anything that
 * does not line up with the variants' channels is a refusal, not a correction.
 *
 * A post can have several targets (one variant per channel), so the rule is coverage: every variant
 * finds its confirmation, and every confirmation finds its variant. Either half missing means the
 * request described a different publish than the one it would perform.
 *
 * Pure, so every refusal reason is testable without a database or a platform.
 */
import type { Platform } from "@/lib/specs/platforms";

export interface PublishConfirmation {
  platform: Platform;
  /** The platform's account id, or the label the operator sees in the picker. */
  account: string;
}

export interface ConfirmationTarget {
  variantId: string;
  platform: Platform;
  accountRef: string;
  label: string | null;
}

export type ConfirmationFailureReason =
  | "platform_mismatch"
  | "account_mismatch"
  | "unknown_target";

export interface ConfirmationFailure {
  /** `null` for a confirmation that named a destination no variant is going to. */
  variantId: string | null;
  reason: ConfirmationFailureReason;
  expected: string;
}

export type ConfirmationReport = { ok: true } | { ok: false; failures: ConfirmationFailure[] };

export function confirmTargets(
  confirmations: PublishConfirmation[],
  targets: ConfirmationTarget[],
): ConfirmationReport {
  const unused = confirmations.map((confirmation) => ({ confirmation, matched: false }));
  const failures: ConfirmationFailure[] = [];

  for (const target of targets) {
    // Prefer a candidate on the right platform: "wrong platform" and "wrong account" are different
    // mistakes, and an operator fixing the second after being told the first wastes a click.
    const samePlatform = unused.filter(
      (entry) => !entry.matched && entry.confirmation.platform === target.platform,
    );
    const match = samePlatform.find(
      (entry) => !entry.matched && knownAccounts(target).includes(normalise(entry.confirmation.account)),
    );

    if (match) {
      match.matched = true;
      continue;
    }

    failures.push({
      variantId: target.variantId,
      reason: samePlatform.length === 0 ? "platform_mismatch" : "account_mismatch",
      expected: `${target.platform}:${target.accountRef}`,
    });
  }

  for (const entry of unused) {
    if (entry.matched) continue;
    failures.push({
      variantId: null,
      reason: "unknown_target",
      expected: `${entry.confirmation.platform}:${entry.confirmation.account}`,
    });
  }

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

function knownAccounts(target: ConfirmationTarget): string[] {
  return [target.accountRef, target.label]
    .filter((value): value is string => typeof value === "string")
    .map(normalise);
}

/** Handles differ in case and in stray whitespace; an account id does not differ at all. */
function normalise(value: string): string {
  return value.trim().toLowerCase();
}
