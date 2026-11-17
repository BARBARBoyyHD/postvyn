/**
 * Email, behind a one-method-per-message port.
 *
 * The port exists so the reset flow can be tested without a network call and so `next dev` works with
 * no Resend key at all. The dev behaviour is Expose-the-link-and-carry-on, which is what every
 * framework does, because the alternative is a developer who cannot sign up locally.
 *
 * The third message is the publish-failure alert (spec: m5-publishing 7.1, ADR-020). It is plain text
 * and short on purpose: one person reads it on a phone at 07:00 and needs the platform's error, which
 * account, where the post is, and the one thing to do about it.
 */
import { Resend } from "resend";
import type { WorkerEnv } from "@/lib/env";

/** What the operator is told when a scheduled publish stops. */
export interface PublishFailureMessage {
  to: string;
  postTitle: string;
  /** The platform's own account id, so "which account" is never ambiguous. */
  platform: string;
  account: string;
  /** The app URL of the post, where the trace lives. */
  postUrl: string;
  /** The platform's code and message, verbatim; null when this app refused before calling. */
  error: { code: string; message: string } | null;
  /** One sentence — exactly one, because a list of options is not an instruction. */
  action: string;
}

export type SentMail =
  | { kind: "verification"; to: string; url: string }
  | { kind: "reset"; to: string; url: string }
  | ({ kind: "publish-failure" } & PublishFailureMessage);

export interface Mailer {
  sendVerification(message: { to: string; url: string }): Promise<void>;
  sendPasswordReset(message: { to: string; url: string }): Promise<void>;
  sendPublishFailure(message: PublishFailureMessage): Promise<void>;
}

/** Used by tests and by any runtime without a key. Records instead of sending. */
export class MemoryMailer implements Mailer {
  readonly sent: SentMail[] = [];

  async sendVerification(message: { to: string; url: string }) {
    this.sent.push({ kind: "verification", ...message });
  }

  async sendPasswordReset(message: { to: string; url: string }) {
    this.sent.push({ kind: "reset", ...message });
  }

  async sendPublishFailure(message: PublishFailureMessage) {
    this.sent.push({ kind: "publish-failure", ...message });
  }
}

/** The body, in the order the reader needs it: what failed, where, why, and what to do. */
export function publishFailureText(message: PublishFailureMessage): string {
  const cause = message.error ? `${message.error.code}: ${message.error.message}` : "no platform error";
  return [
    "A scheduled publish stopped and it will not be retried.",
    "",
    `Platform: ${message.platform} (account ${message.account})`,
    `Post: ${message.postTitle} — ${message.postUrl}`,
    `Platform error: ${cause}`,
    "",
    `What to do: ${message.action}`,
    "",
  ].join("\n");
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

  async sendPublishFailure(message: PublishFailureMessage) {
    await this.sendText(
      message.to,
      `Publish failed on ${message.platform}: ${message.postTitle}`,
      publishFailureText(message),
    );
  }

  private async send(to: string, subject: string, url: string, lead: string) {
    await this.sendText(
      to,
      subject,
      `${lead}\n\n${url}\n\nThis link expires shortly. If you did not ask for this, ignore the message.\n`,
    );
  }

  private async sendText(to: string, subject: string, text: string) {
    const { error } = await this.client.emails.send({ from: this.from, to, subject, text });
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
