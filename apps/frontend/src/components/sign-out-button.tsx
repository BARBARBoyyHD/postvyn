"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Sign-out as a real request, not a link.
 *
 * Better Auth's sign-out is a POST; making it a `fetch` keeps the browser from navigating to a JSON
 * body, and the redirect afterwards is what the operator expects to see.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } finally {
      router.push("/sign-in");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted transition-colors hover:text-zavron-ink disabled:opacity-50"
    >
      {busy ? "signing out…" : "sign out"}
    </button>
  );
}
