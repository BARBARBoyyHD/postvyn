/**
 * The Better Auth instance, built per request.
 *
 * Two rules that are not style choices:
 *
 * 1. **Per request, from `env`.** A module-level instance captures the binding of whichever isolate
 *    loaded it. On Workers that binding can be dead when the isolate is reused, and the symptom is
 *    intermittent 500s that reproduce only under load.
 * 2. **The Web handler, not a framework adapter.** `auth.handler(request)` returns a `Response`, so
 *    this works on any runtime — including vinext, which is young enough that adapters are a risk
 *    worth not taking (ADR-017).
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb, fullSchema } from "@/db/client";
import { identityStore } from "@/db/identity";
import { repository } from "@/db/repository";
import type { WorkerEnv } from "@/lib/env";
import { requireAuthEnv } from "@/lib/env";
import { mailerFrom } from "@/lib/email";

/** Roughly thirty days, refreshed while the operator is active (design Q2). */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function createAuth(env: WorkerEnv) {
  const { secret, baseURL } = requireAuthEnv(env);
  const db = createDb(env.DB);
  const mail = mailerFrom(env);

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema: fullSchema }),
    secret,
    baseURL,

    /**
     * Both dev ports, because `pnpm dev` runs Next on 3000 and `pnpm dev:vinext` runs Vite on 3001 —
     * and Better Auth rejects a request whose Origin it does not trust (MISSING_OR_NULL_ORIGIN).
     */
    trustedOrigins: [baseURL, "http://localhost:3000", "http://localhost:3001"],

    emailAndPassword: {
      enabled: true,
      // Resend is deferred, so a verification mail cannot be delivered; requiring one would lock
      // every new account out. Sign-up therefore issues a session immediately - flip this (and
      // restore the `emailVerification` block) when mail is wired.
      requireEmailVerification: false,
      minPasswordLength: 10,
      sendResetPassword: async ({ user, url }) => {
        await mail.sendPasswordReset({ to: user.email, url });
      },
    },

    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 60 * 60 * 24, // slide the window once a day, not on every request
      cookieCache: { enabled: false },
    },

    advanced: {
      // `x-forwarded-for`'s first hop is caller-controlled; `cf-connecting-ip` is set by Cloudflare.
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      },
    },

    /**
     * Throttle the endpoints that cost something: three signups and three resets per window per IP is
     * generous for one operator and hostile to a script. Sign-in is tighter, because that is where
     * credential stuffing lands.
     */
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 300, max: 3 },
        "/forget-password": { window: 300, max: 3 },
      },
    },

    /**
     * Audit sign-ins. Failures here must never break authentication, so the hook swallows its own
     * errors — a broken audit trail is bad, a login that fails because of the audit trail is worse.
     */
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            try {
              const membership = await identityStore(env).findPrimaryMembership(session.userId);
              if (!membership) return;
              await repository(env).recordActivity(
                {
                  workspaceId: membership.workspaceId,
                  userId: session.userId,
                  role: membership.role,
                },
                { action: "auth.signed_in" },
              );
            } catch (error) {
              console.error("[audit] could not record sign-in", error);
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
