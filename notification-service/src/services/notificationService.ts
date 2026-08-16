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
  /**
   * FIXED — this handler now reads what `createInvite` actually publishes.
   *
   * It previously destructured `{ hostTeam, acceptedTeam }` from a payload carrying
   * `{ sender, receiver }`, so both were undefined and the send threw on every
   * invite. That was half of the "invite emails never arrive" defect; the other half
   * was `createInvite` publishing without `purpose`, so this handler was never even
   * reached. Both halves are fixed, and the ORDER mattered: making the path reachable
   * first would have converted a silent no-op into a crash on every invite.
   *
   * Role mapping, from the template's own wording ("Hello <host>, <challenger> is
   * interested in playing against you"):
   *   receiver -> the team hosting the match, and the recipient of this email
   *   sender   -> the challenging team, named in the body
   */
  const handleInvite = async (event: InviteNotification): Promise<void> => {
    try {
      const { sender, receiver, matchId, inviteId } = event;
      const hostTeam = receiver;
      const challengerTeam = sender;

      logger.info('Sending invite email to host team', {
        inviteId,
        matchId,
        to: hostTeam?.email,
      });

      /**
       * Enrichment is best-effort upstream: match-service's axios lookups can time
       * out or be rate-limited, in which case only `teamId` survives. Without an
       * address there is nothing to send, so skip loudly rather than throw — the
       * throw is what used to bury this whole path in a caught error.
       */
      if (!hostTeam?.email) {
        logger.warn(
          'Invite notification carried no host email — upstream enrichment failed; no email sent',
          { inviteId, matchId, hostTeamId: hostTeam?.teamId },
        );
        return;
      }

      const body = inviteTemplate(
        {
          teamName: hostTeam.teamName ?? 'there',
          collegeName: hostTeam.collegeName ?? '',
        },
        {
          teamName: challengerTeam?.teamName ?? 'Another team',
          collegeName: challengerTeam?.collegeName ?? 'unknown college',
        },
      );

      await mailer.sendMail({
        to: hostTeam.email,
        subject: 'New Match Invite!',
        html: body,
        // Supplying these is what lets the delivery-audit row be written.
        recipientTeamId: hostTeam.teamId,
        type: 'invite.sent',
        matchId,
        inviteId,
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
