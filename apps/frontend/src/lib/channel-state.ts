/**
 * A channel's state is what is known about its credentials, not what a column last said.
 *
 * Three states, and the order matters: `disabled` is the operator's decision and outranks everything
 * else, so disconnecting is not undone by a later read. A channel with no credential row is
 * `reauth_required` rather than `active` — an imported channel was never connected, and pretending
 * otherwise means a publish is attempted against an account nobody has authorised.
 */
export type ChannelStatus = "active" | "reauth_required" | "disabled";

export function effectiveChannelStatus(stored: ChannelStatus, hasCredentials: boolean): ChannelStatus {
  if (stored === "disabled") return "disabled";
  if (!hasCredentials) return "reauth_required";
  return stored;
}
