/**
 * The kill switch, as a read-only chip.
 *
 * Two switches stop a claim: the deployment-wide `PUBLISHING_ENABLED` and the workspace's own
 * `publishing_enabled`. Showing only "on/off" would hide which one an operator has to change, so the
 * label names the reason. Changing either is not a control this chip offers.
 */
export function PublishingState({
  globalEnabled,
  workspaceEnabled,
}: {
  globalEnabled: boolean;
  workspaceEnabled: boolean;
}) {
  const enabled = globalEnabled && workspaceEnabled;
  const reason = enabled
    ? "Publishing is enabled"
    : globalEnabled
      ? "Publishing paused for this workspace"
      : "Publishing paused by the global kill switch";

  return (
    <span
      aria-label={reason}
      title={reason}
      className="inline-flex items-center gap-1.5 rounded-full border border-zavron-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted"
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-400" : "bg-amber-400"}`}
      />
      {enabled ? "publishing" : "paused"}
    </span>
  );
}
