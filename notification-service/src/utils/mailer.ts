import nodemailer, { type Transporter } from 'nodemailer';
import { Notification, type NotificationType } from '../models/Notification.js';
import { env, emailConfigured } from '../env.js';

/**
 * Arguments both call sites in `services/notificationService.ts` pass.
 *
 * Every field is optional because that is what actually arrives: the two callers
 * pass only `{ to, subject, html }`, and `to` itself is `EnrichedTeam.email`, which
 * the event contract marks optional. `recipientTeamId` and `type` are declared here
 * because `sendMail` reads them — but NOTHING ever passes them. See the create()
 * note below; that omission is why the notifications collection is always empty.
 */
export interface SendMailArgs {
  to?: string | undefined;
  subject?: string | undefined;
  text?: string | undefined;
  html?: string | undefined;
  /** Supplying these two is what enables the delivery-audit row; see writeAuditRecord. */
  recipientTeamId?: string | undefined;
  type?: NotificationType | undefined;
  matchId?: string | undefined;
  inviteId?: string | undefined;
}

export interface Mailer {
  sendMail(args: SendMailArgs): Promise<boolean>;
}

/**
 * Builds the SMTP transport and the single send function the notification handlers use.
 *
 * Called once from `server.ts`, before `startServer()`. In the original this file ran
 * at `require` time — the transport was constructed and `verify()` fired as a side
 * effect of importing `notificationService.js`. Moving it into a factory makes the
 * ordering explicit without changing what happens (D-NT-04).
 *
 * Gmail SMTP with a personal app password is the only transport, with no provider
 * abstraction, no retry, and no bounce handling. Preserved as-is; backlog item 9.
 */
export function createMailer(): Mailer {
  /**
   * SMTP_HOST wins when set, so the stack can send real mail into a local catcher
   * (Mailpit in docker-compose) and the smoke test can assert delivery. When it is
   * unset — production — this is byte-for-byte the original Gmail transport.
   */
  const transporter: Transporter = env.SMTP_HOST
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: false,
        ignoreTLS: true,
      })
    : nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: env.EMAIL_USER,
          pass: env.EMAIL_APP_PASSWORD,
        },
      });

  /**
   * Fire-and-forget credential check at startup. Its result gates nothing — a failed
   * verify logs and the service still starts and still tries to send. Preserved.
   *
   * Skipped entirely when the credentials are absent, because there is nothing to
   * verify: `verify()` would spend a TLS round-trip to Gmail only to print a
   * multi-line EAUTH stack trace on every boot of an intentionally unconfigured
   * stack, burying real errors in the log. The one-line warning replaces it and
   * carries the diagnostic that `env.ts` used to throw for. When the credentials ARE
   * present, this path is byte-for-byte what it was.
   */
  if (!emailConfigured) {
    console.warn(
      '⚠️  EMAIL_USER / EMAIL_APP_PASSWORD not set — SMTP is unconfigured. ' +
        'The service is otherwise fully operational: events are still consumed and ' +
        'dispatched, but every outbound email will fail at send time.',
    );
  } else {
    transporter.verify((error) => {
      if (error) {
        console.error('❌ Email transporter verification failed:', error);
      } else {
        console.log('✅ Email transporter ready to send emails');
      }
    });
  }

  const sendMail = async ({
    to,
    subject,
    text,
    html,
    recipientTeamId,
    type,
    matchId,
    inviteId,
  }: SendMailArgs): Promise<boolean> => {
    try {
      const mailOptions = {
        // Falls back to a valid literal so the direct-SMTP path still has a From
        // header when EMAIL_USER is blank (the Mailpit setup).
        from: `"Football Fixer Notifications" <${env.EMAIL_USER || 'no-reply@uff.local'}>`,
        to,
        subject,
        text,
        html,
      };

      const info = await transporter.sendMail(mailOptions);
      // D-NT-07: console, not the winston logger — preserved from the original so
      // the emitted lines are unchanged. Backlog item 15.
      console.log(`📧 Email sent: ${info.messageId} → ${to}`);

      /**
       * FIXED (was D-NT-06). The audit write can no longer fail the send.
       *
       * Previously this ran unguarded on the success path with a payload that could
       * never satisfy the schema — `recipientTeamId` and `type` are required and no
       * caller supplied them — so `Notification.create()` rejected AFTER the mail had
       * already gone out. The rejection escaped `sendMail`, so every successful send
       * was reported as a failure, and in `handleMatchFixed` it aborted the remaining
       * emails: a match.fixed event owing two sends produced exactly one.
       *
       * Two changes: the record is only written when the caller supplies the fields
       * the schema requires, and the write is isolated in its own try/catch so an
       * audit failure can never propagate to the send result. Delivery is the
       * product behaviour; the audit row is bookkeeping, and bookkeeping must not be
       * able to un-send an email.
       */
      await writeAuditRecord({
        recipientTeamId,
        type,
        recipientEmail: to,
        matchId,
        inviteId,
        message: subject,
        status: 'sent',
      });

      return true;
    } catch (error) {
      console.error('❌ Error sending email:', error);

      await writeAuditRecord({
        recipientTeamId,
        type,
        recipientEmail: to,
        matchId,
        inviteId,
        message: subject || 'Notification failed',
        status: 'failed',
        error: (error as Error).message,
      });

      // Now reachable. Previously the failure-path write threw before this line.
      return false;
    }
  };

  return { sendMail };
}

interface AuditRecordArgs {
  recipientTeamId?: string | undefined;
  type?: NotificationType | undefined;
  recipientEmail?: string | undefined;
  matchId?: string | undefined;
  inviteId?: string | undefined;
  message?: string | undefined;
  status: 'sent' | 'failed';
  error?: string | undefined;
}

/**
 * Writes the delivery-audit row, and never throws.
 *
 * Skips silently when the caller did not supply the schema-required fields, which is
 * what `handleMatchFixed` still does — that path keeps its original behaviour of
 * writing nothing, but it no longer pays for the omission with a rejected send.
 */
async function writeAuditRecord(args: AuditRecordArgs): Promise<void> {
  if (!args.recipientTeamId || !args.type) {
    return;
  }
  try {
    await Notification.create({
      recipientTeamId: args.recipientTeamId,
      recipientEmail: args.recipientEmail,
      matchId: args.matchId,
      inviteId: args.inviteId,
      type: args.type,
      message: args.message ?? 'Notification',
      delivery: {
        channel: 'email',
        status: args.status,
        ...(args.error ? { error: args.error } : {}),
      },
    });
  } catch (err) {
    // Bookkeeping only — never allowed to affect the send result.
    console.error('⚠️  Failed to write notification audit record:', (err as Error).message);
  }
}
