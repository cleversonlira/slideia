import nodemailer, { type Transporter } from "nodemailer";
import type { RemoteConfig } from "./config.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
  /** Last messages (console driver only), shown on a dev page and read by tests. */
  readonly outbox?: Mail[];
}

/** Development: prints e-mails to stderr and keeps the last ones in memory. */
export class ConsoleMailer implements Mailer {
  readonly outbox: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.outbox.unshift(mail);
    this.outbox.splice(50);
    console.error(`[mail] para ${mail.to}: ${mail.subject}\n${mail.text}\n`);
  }
}

class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...mail });
  }
}

class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  async send(mail: Mail): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });
    if (!res.ok) throw new Error(`Resend: HTTP ${res.status} ${await res.text()}`);
  }
}

export function createMailer(config: RemoteConfig): Mailer {
  const m = config.mail;
  if (m.driver === "smtp") {
    if (!m.smtpUrl) throw new Error("MAIL_DRIVER=smtp requires SMTP_URL");
    return new SmtpMailer(m.smtpUrl, m.from);
  }
  if (m.driver === "resend") {
    if (!m.resendApiKey) throw new Error("MAIL_DRIVER=resend requires RESEND_API_KEY");
    return new ResendMailer(m.resendApiKey, m.from);
  }
  return new ConsoleMailer();
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Simple transactional e-mail with one call-to-action button. */
export function actionMail(
  to: string,
  subject: string,
  intro: string,
  action: string,
  url: string,
  outro: string,
): Mail {
  return {
    to,
    subject,
    text: `${intro}\n\n${action}: ${url}\n\n${outro}`,
    html: `<div style="font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;color:#1f2933">
<p>${esc(intro)}</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#2f6bff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${esc(action)}</a></p>
<p style="color:#687083;font-size:14px">${esc(outro)}</p></div>`,
  };
}
