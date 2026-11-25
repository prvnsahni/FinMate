import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/** Low-level parameters for a single outbound message. */
interface SendOptions {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Derived from `html` when omitted. */
  text?: string;
  /** Overrides the branded default sender. */
  from?: string;
}

/** Content for the shared branded layout. */
interface TemplateOptions {
  /** Preheader / accessible page title. */
  title: string;
  heading: string;
  /** Body paragraphs as ready-to-render HTML (already escaped/trusted). */
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /** Small print below the CTA (e.g. expiry note). */
  footnote?: string;
}

/**
 * Centralized transactional email for FinMate.
 *
 * The single place email is sent from — every flow renders through one branded
 * layout and one resilient dispatcher (Resend HTTP API). Sends are best-effort:
 * transient failures are retried and all failures are logged, but provider
 * errors are never thrown back to the caller (and so never surface to the API
 * client). When no API key is configured, messages are logged instead of sent.
 */
@Injectable()
export class EmailService {
  private readonly resendApiKey: string | null;
  private readonly defaultFrom: string;
  private readonly fromEmail: string;
  private readonly supportEmail: string;
  private readonly logger = new Logger(EmailService.name);

  private static readonly RESEND_ENDPOINT = 'https://api.resend.com/emails';
  private static readonly MAX_ATTEMPTS = 3;
  private static readonly BRAND_COLOR = '#006241';
  private static readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  constructor(private readonly configService: ConfigService) {
    this.resendApiKey =
      this.configService.get<string>('RESEND_API_KEY') || null;

    const fromName =
      this.configService.get<string>('MAIL_FROM_NAME') || 'Samma';
    // MAIL_FROM_EMAIL is canonical; FROM_EMAIL is kept as a back-compat fallback.
    // Normalize to a bare address: if a full "Name <email>" is configured here
    // by mistake, using it verbatim would produce an invalid, doubly-wrapped
    // "Name <Name <email>>" From header that providers reject (Resend 422).
    this.fromEmail = EmailService.extractEmailAddress(
      this.configService.get<string>('MAIL_FROM_EMAIL') ||
        this.configService.get<string>('FROM_EMAIL') ||
        'noreply@mail.prvnsahni.com',
    );
    this.defaultFrom = `${fromName} <${this.fromEmail}>`;

    this.supportEmail = EmailService.extractEmailAddress(
      this.configService.get<string>('SUPPORT_EMAIL') || this.fromEmail,
    );

    if (!this.resendApiKey) {
      this.logger.warn(
        'RESEND_API_KEY is not set. Emails will be logged to the console instead of being sent.',
      );
    }
  }

  // ─── Public flows ──────────────────────────────────────────────────────────

  /**
   * Low-level send. Kept for ad-hoc callers; prefer the branded flow helpers
   * below. Never throws — the returned promise always resolves.
   */
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    return this.dispatch({ to, subject, html, text });
  }

  async sendInviteEmail(
    toEmail: string,
    groupName: string,
    inviteUrl: string,
    inviterName: string,
  ): Promise<void> {
    const subject = `You're invited to join "${groupName}" on Samma`;
    const html = this.render({
      title: subject,
      heading: 'Group invitation',
      bodyHtml: `
        <p style="margin:0 0 16px;">Hi there,</p>
        <p style="margin:0 0 16px;"><strong>${this.escape(
          inviterName,
        )}</strong> has invited you to join the group
        <strong>${this.escape(
          groupName,
        )}</strong> on Samma to track and split shared expenses.</p>
        <p style="margin:0 0 8px;">Use the button below to accept the invitation:</p>`,
      ctaLabel: 'Join group',
      ctaUrl: inviteUrl,
      footnote:
        "If you don't have a Samma account yet, you'll be prompted to create one when you open the link.",
    });
    const text = this.text(
      `${inviterName} has invited you to join the group "${groupName}" on Samma.`,
      'Join the group',
      inviteUrl,
    );
    await this.dispatch({ to: toEmail, subject, html, text });
  }

  async sendVerificationEmail(
    toEmail: string,
    verificationUrl: string,
  ): Promise<void> {
    const subject = 'Verify your email — Samma';
    const html = this.render({
      title: subject,
      heading: 'Welcome to Samma!',
      bodyHtml: `
        <p style="margin:0 0 16px;">Thanks for signing up. Confirm your email
        address to activate your account and automatically link any groups you
        were added to before registering.</p>`,
      ctaLabel: 'Verify email',
      ctaUrl: verificationUrl,
      footnote:
        'This link expires in 24 hours. If you did not create a Samma account, you can safely ignore this email.',
    });
    const text = this.text(
      'Confirm your email address to activate your Samma account.',
      'Verify your email',
      verificationUrl,
    );
    await this.dispatch({ to: toEmail, subject, html, text });
  }

  async sendPasswordResetEmail(
    toEmail: string,
    resetUrl: string,
  ): Promise<void> {
    const subject = 'Reset your password — Samma';
    const html = this.render({
      title: subject,
      heading: 'Password reset',
      bodyHtml: `
        <p style="margin:0 0 16px;">We received a request to reset your Samma
        password. Click the button below to choose a new one.</p>`,
      ctaLabel: 'Reset password',
      ctaUrl: resetUrl,
      footnote:
        'This link is valid for 1 hour. If you did not request a reset, you can safely ignore this email.',
    });
    const text = this.text(
      'We received a request to reset your Samma password.',
      'Reset your password',
      resetUrl,
    );
    await this.dispatch({ to: toEmail, subject, html, text });
  }

  // ─── Dispatch ────────────────────────────────────────────────────────────────

  /**
   * Sends one message with bounded retries. Validates the recipient, honours
   * the mock (no-key) path, retries only transient failures (network, 429,
   * 5xx), logs every failure, and never throws.
   */
  private async dispatch(opts: SendOptions): Promise<void> {
    const from = opts.from ?? this.defaultFrom;
    const text = opts.text ?? this.htmlToText(opts.html);

    if (!EmailService.EMAIL_RE.test(opts.to)) {
      this.logger.error(
        `Refusing to send "${opts.subject}": invalid recipient address "${opts.to}"`,
      );
      return;
    }

    if (!this.resendApiKey) {
      this.logger.log(
        `[MOCK EMAIL] from=${from} to=${opts.to} subject="${opts.subject}"`,
      );
      return;
    }

    for (let attempt = 1; attempt <= EmailService.MAX_ATTEMPTS; attempt++) {
      try {
        await axios.post(
          EmailService.RESEND_ENDPOINT,
          { from, to: opts.to, subject: opts.subject, html: opts.html, text },
          {
            headers: {
              Authorization: `Bearer ${this.resendApiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );
        this.logger.log(`Email sent to ${opts.to} ("${opts.subject}")`);
        return;
      } catch (error: unknown) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        const detail = axios.isAxiosError(error)
          ? (error.response?.data ?? error.message)
          : String(error);
        const transient =
          status === undefined || status === 429 || status >= 500;

        this.logger.error(
          `Email to ${opts.to} failed (attempt ${attempt}/${EmailService.MAX_ATTEMPTS}, ` +
            `status ${status ?? 'network'}): ${JSON.stringify(detail)}`,
        );

        if (!transient || attempt === EmailService.MAX_ATTEMPTS) {
          this.logger.error(
            `Giving up on email to ${opts.to} ("${opts.subject}")`,
          );
          return;
        }
        await this.delay(this.retryDelayMs(attempt));
      }
    }
  }

  private retryDelayMs(attempt: number): number {
    return attempt * 300;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ─── Templating ──────────────────────────────────────────────────────────────

  /** Renders the shared, email-client-safe branded layout. */
  private render(opts: TemplateOptions): string {
    const brand = EmailService.BRAND_COLOR;
    const button =
      opts.ctaUrl && opts.ctaLabel
        ? `
            <tr>
              <td style="padding:8px 0 4px;">
                <a href="${opts.ctaUrl}"
                   style="display:inline-block;background:${brand};color:#ffffff;
                          text-decoration:none;padding:14px 28px;border-radius:8px;
                          font-weight:600;font-size:15px;">${this.escape(opts.ctaLabel)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 0 0;font-size:12px;color:#8a8f98;word-break:break-all;">
                Or paste this link into your browser:<br />
                <a href="${opts.ctaUrl}" style="color:${brand};">${opts.ctaUrl}</a>
              </td>
            </tr>`
        : '';
    const footnote = opts.footnote
      ? `<tr><td style="padding:24px 0 0;font-size:13px;color:#8a8f98;">${this.escape(
          opts.footnote,
        )}</td></tr>`
      : '';

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${this.escape(opts.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f5f7;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${this.escape(
      opts.title,
    )}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f4f5f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0"
                 style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;
                        overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',
                        Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td style="background:${brand};padding:24px 32px;">
                <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.3px;">Samma</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#1f2328;font-size:15px;line-height:1.55;">
                <h1 style="margin:0 0 20px;font-size:20px;color:#1f2328;">${this.escape(
                  opts.heading,
                )}</h1>
                ${opts.bodyHtml}
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  ${button}
                  ${footnote}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#fafbfc;border-top:1px solid #eceef1;
                         font-size:12px;color:#8a8f98;line-height:1.5;">
                Need help? Contact us at
                <a href="mailto:${this.supportEmail}" style="color:${brand};">${this.supportEmail}</a>.<br />
                &copy; ${new Date().getFullYear()} Samma. You are receiving this email because an action was taken with your address.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  /** Builds a plain-text alternative for a simple single-CTA message. */
  private text(intro: string, ctaLabel: string, ctaUrl: string): string {
    return [
      'Samma',
      '',
      intro,
      '',
      `${ctaLabel}: ${ctaUrl}`,
      '',
      `Need help? Contact us at ${this.supportEmail}.`,
    ].join('\n');
  }

  /** Best-effort HTML→text fallback for ad-hoc sends without explicit text. */
  private htmlToText(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h[1-6]|td)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&copy;/g, '(c)')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  /**
   * Normalizes a configured sender/support value to a bare email address.
   * Accepts either `email@example.com` or `Name <email@example.com>` and always
   * returns just the address, so a mis-set env value can never produce an
   * invalid `From` header. Falls back to the trimmed input if no address is found.
   */
  private static extractEmailAddress(value: string): string {
    const angle = value.match(/<([^>]+)>/);
    const candidate = (angle ? angle[1] : value).trim();
    const bare = candidate.match(/[^\s<>]+@[^\s<>]+\.[^\s<>]+/);
    return bare ? bare[0] : candidate;
  }

  /** Escapes user-provided text for safe interpolation into HTML. */
  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
