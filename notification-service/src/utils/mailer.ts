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
  recipientTeamId?: string | undefined;
  type?: NotificationType | undefined;
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
  const transporter: Transporter = nodemailer.createTransport({
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
  }: SendMailArgs): Promise<boolean> => {
    try {
      const mailOptions = {
        from: `"Football Fixer Notifications" <${env.EMAIL_USER}>`,
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
       * D-NT-06 — REPRODUCED DEFECT, DO NOT "FIX".
       *
       * This write can never succeed. `recipientTeamId` and `type` are required on
       * the schema and neither caller supplies them; `metadata` and the top-level
       * `status` are not schema paths at all (Mongoose's default `strict` silently
       * drops them). So every call rejects with a ValidationError.
       *
       * Consequence, and the reason this matters: the mail above HAS already been
       * sent by the time this throws, but the rejection escapes `sendMail` — the
       * catch below re-attempts the same impossible write and rejects again. The
       * caller sees `sendMail` reject after a successful send. In
       * `handleMatchFixed` that aborts the remaining two-or-more emails. See FLOW.md.
       *
       * The cast is what lets the mismatched literal compile. Correcting either side
       * — the payload or the schema — would change observable behaviour, so both are
       * left disagreeing.
       */
      await Notification.create({
        recipientTeamId, // required by the schema, always undefined here
        type, // required by the schema, always undefined here
        message: subject, // required → the original reuses the subject line
        metadata: { to, subject, text, html }, // not a schema path
        status: 'sent', // not a schema path; the real one is delivery.status
      } as unknown as INotificationWrite);

      return true;
    } catch (error) {
      console.error('❌ Error sending email:', error);

      // Same impossible write on the failure path, so this rejects too and the
      // `return false` below is unreachable. Preserved (D-NT-06).
      await Notification.create({
        recipientTeamId,
        type,
        message: subject || 'Notification failed',
        metadata: { to, subject, text, html, error: (error as Error).message },
        status: 'failed',
      } as unknown as INotificationWrite);

      return false;
    }
  };

  return { sendMail };
}

/**
 * The shape the two `create()` calls above actually pass — named so the casts read as
 * a deliberate statement rather than a shrug. It is not assignable to the schema type
 * and is not meant to be.
 */
interface INotificationWrite {
  recipientTeamId: string | undefined;
  type: NotificationType | undefined;
  message: string | undefined;
  metadata: Record<string, string | undefined>;
  status: 'sent' | 'failed';
}
