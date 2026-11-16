/**
 * Email, behind a one-method-wide port.
 *
 * The port exists so the reset flow can be tested without a network call and so `next dev` works with
 * no Resend key at all. The dev behaviour is Expose-the-link-and-carry-on, which is what every
 * framework does, because the alternative is a developer who cannot sign up locally.
 */
import { Resend } from "resend";
import type { WorkerEnv } from "@/lib/env";

export interface Mailer {
  sendVerification(message: { to: string; url: string }): Promise<void>;
  sendPasswordReset(message: { to: string; url: string }): Promise<void>;
}

/** Used by tests and by any runtime without a key. Records instead of sending. */
export class MemoryMailer implements Mailer {
  readonly sent: { kind: "verification" | "reset"; to: string; url: string }[] = [];

  async sendVerification(message: { to: string; url: string }) {
    this.sent.push({ kind: "verification", ...message });
  }

  async sendPasswordReset(message: { to: string; url: string }) {
    this.sent.push({ kind: "reset", ...message });
  }
}

class ResendMailer implements Mailer {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async sendVerification({ to, url }: { to: string; url: string }) {
    await this.send(to, "Confirm your email", url, "Confirm your email address to finish setting up.");
  }

  async sendPasswordReset({ to, url }: { to: string; url: string }) {
    await this.send(to, "Reset your password", url, "Someone asked to reset your password. If that was you:");
  }

  private async send(to: string, subject: string, url: string, lead: string) {
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject,
      text: `${lead}\n\n${url}\n\nThis link expires shortly. If you did not ask for this, ignore the message.\n`,
    });
    if (error) throw new Error(`Resend refused the message: ${error.message}`);
  }
}

/**
 * The dev mailer keeps the last messages so the link can be read from the terminal or a test.
 * `RESEND_API_KEY` absent is not an error here — it is the normal state of a fresh clone.
 */
export const devOutbox = new MemoryMailer();

export function mailerFrom(env: WorkerEnv): Mailer {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return devOutbox;
  }
  return new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
}
