import nodemailer from "nodemailer";
import { config } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailDriver {
  readonly name: string;
  send(msg: EmailMessage): Promise<void>;
}

class LogEmailDriver implements EmailDriver {
  readonly name = "log";
  async send(msg: EmailMessage): Promise<void> {
    logger.info("email via log driver", {
      to: msg.to,
      subject: msg.subject,
      text: msg.text.slice(0, 500),
    });
  }
}

class SmtpEmailDriver implements EmailDriver {
  readonly name = "smtp";
  private transporter: ReturnType<typeof nodemailer.createTransport>;
  private from: string;

  constructor(cfg: { host: string; port: number; secure: boolean; user: string; pass: string; from: string }) {
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
    this.from = cfg.from;
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }
}

class ResendEmailDriver implements EmailDriver {
  readonly name = "resend";
  constructor(private apiKey: string, private from: string) {}

  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend API ${res.status}: ${body.slice(0, 300)}`);
    }
  }
}

let cached: EmailDriver | null = null;

export function emailDriver(): EmailDriver {
  if (cached) return cached;
  const e = config.email;
  if (e.provider === "smtp" && e.smtp.host && e.from) {
    cached = new SmtpEmailDriver({ ...e.smtp, from: e.from });
  } else if (e.provider === "resend" && e.resend.apiKey && e.from) {
    cached = new ResendEmailDriver(e.resend.apiKey, e.from);
  } else {
    if (e.provider !== "log") {
      logger.warn("EMAIL_PROVIDER set but incomplete; falling back to log driver", { provider: e.provider });
    }
    cached = new LogEmailDriver();
  }
  return cached;
}

export async function sendMail(msg: EmailMessage): Promise<void> {
  try {
    await emailDriver().send(msg);
  } catch (err) {
    logger.error("email send failed", {
      to: msg.to,
      driver: emailDriver().name,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function passwordResetUrl(token: string): string {
  return `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = passwordResetUrl(token);
  await sendMail({
    to,
    subject: "Reset your password",
    text: `We received a request to reset your password. Open the link below to choose a new one (valid for 6 hours):\n\n${url}\n\nIf you didn't ask for this, you can safely ignore this email.`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6">
<p>We received a request to reset your password. Open the link below to choose a new one (valid for 6 hours):</p>
<p><a href="${url}">${url}</a></p>
<p>If you didn't ask for this, you can safely ignore this email. Your password stays unchanged.</p>
</body></html>`,
  });
}