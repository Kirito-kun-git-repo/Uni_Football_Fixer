import type { Logger } from '@uff/shared/logger';
import type { InviteNotification, MatchFixedNotification, TeamSummary } from '@uff/shared/events';
import type { Mailer } from '../utils/mailer.js';
import { inviteTemplate, matchFixedTemplate, rejectTemplate } from '../utils/templates.js';

/**
 * What `handleInvite` READS off the invite event — deliberately not what arrives on it.
 *
 * `InviteNotification` (see `@uff/shared/events`) carries `{ sender, receiver }`.
 * This handler destructures `{ hostTeam, acceptedTeam }`. The two have never agreed,
 * so both locals are `undefined` at runtime on every single invite. That is the
 * dual-path divergence D-05 preserves; see FLOW.md and backlog item 2.
 */
interface InviteEventAsRead {
  hostTeam?: TeamSummary | undefined;
  acceptedTeam?: TeamSummary | undefined;
}

export interface NotificationHandlers {
  handleInvite(event: InviteNotification): Promise<void>;
  handleMatchFixed(event: MatchFixedNotification): Promise<void>;
}

/**
 * The two branches of the `notification` routing key's dispatch switch, built in
 * `server.ts` and called from the consumer registered there.
 *
 * Both handlers swallow their own errors. That is load-bearing to understand: the
 * shared RabbitMQ client only dead-letters a message when the handler throws, so
 * catching here means the DLQ is unreachable from this service and a failed send is
 * acked and gone. Preserved from the original — backlog item 12.
 */
export function createNotificationService(logger: Logger, mailer: Mailer): NotificationHandlers {
  /**
   * BROKEN END TO END, PRESERVED DELIBERATELY.
   *
   * `inviteTemplate(hostTeam, acceptedTeam)` is the first thing that touches the
   * destructured locals, and it reads `hostTeam.teamName` — so this throws a
   * `TypeError: Cannot read properties of undefined` there, before `hostTeam.email`
   * is ever evaluated and before `mailer.sendMail` is reached. The catch logs it and
   * returns normally. No invite email has ever been delivered by this service.
   *
   * On top of that, match-service's synchronous invite path publishes without a
   * `purpose` field at all, so most invites never even reach this function — they
   * fall through the dispatch switch to `default`. See FLOW.md.
   */
  const handleInvite = async (event: InviteNotification): Promise<void> => {
    try {
      // The cast is the divergence made explicit: these keys are not on the contract.
      const { hostTeam, acceptedTeam } = event as unknown as InviteEventAsRead;
      logger.info('Sending invite email to host and accepted team ', hostTeam, acceptedTeam);

      const subject = 'New Match Invite!';
      // Non-null assertions reproduce the original unguarded reads. Both are in fact
      // always undefined, so this line throws. Backlog item 2 — adding a guard here
      // would change behaviour from "throws and logs" to "silently does nothing".
      const body = inviteTemplate(hostTeam!, acceptedTeam!);

      await mailer.sendMail({
        to: hostTeam!.email,
        subject,
        html: body,
      });
    } catch (err) {
      logger.error('Error in sending mail for invite', err);
    }
  };

  /**
   * The only notification path that works today.
   *
   * Sends up to 2 + N emails: one to the host, one to the accepted team, then one
   * rejection per losing team, sequentially. The loop is sequential in the original
   * and stays sequential — backlog item 10.
   */
  const handleMatchFixed = async (event: MatchFixedNotification): Promise<void> => {
    try {
      logger.info('Sending fixed match emails');

      const { hostTeam, acceptedTeam, rejectedTeams } = event;

      // `hostTeam` and `acceptedTeam` are optional on the contract — match-service's
      // batch enrichment omits an entry whose lookup failed. The original did not
      // guard, so a missing team throws here and the catch below swallows it,
      // cancelling every remaining email. Asserted rather than guarded so that
      // behaviour is preserved exactly; backlog item 2.
      await mailer.sendMail({
        to: hostTeam!.email,
        subject: 'Match Fixed!',
        html: matchFixedTemplate(hostTeam!, acceptedTeam!),
      });

      await mailer.sendMail({
        to: acceptedTeam!.email,
        subject: 'Match Fixed!',
        html: matchFixedTemplate(acceptedTeam!, hostTeam!),
      });

      for (const team of rejectedTeams) {
        await mailer.sendMail({
          to: team.email,
          subject: 'Match Invite Rejected',
          html: rejectTemplate(team, hostTeam!),
        });
      }
    } catch (err) {
      logger.error('Error in sending mail for fixed match', err);
    }
  };

  return { handleInvite, handleMatchFixed };
}
