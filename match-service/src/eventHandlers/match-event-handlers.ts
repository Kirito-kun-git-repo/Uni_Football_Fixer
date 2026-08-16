import type { Logger } from '@uff/shared/logger';
import { publishEvent } from '@uff/shared/rabbitmq';
import type {
  EnrichedTeam,
  EventMap,
  MatchFixedNotification,
  NotificationEvent,
} from '@uff/shared/events';
import { Match } from '../models/Match.js';

/** A team as this service republishes it: same shape as `EnrichedTeam` minus `role`. */
type StrippedTeam = Omit<EnrichedTeam, 'role'>;

/**
 * D-MT-04 (2 of 3): what `handleTeamDetailForRespondingToInviteEvent` actually puts on
 * the wire. It differs from the shared `MatchFixedNotification` in one respect — the
 * two single-team fields are published as explicit `null` when a role produced no
 * team, where the contract declares them optional (key absent). notification-service
 * dereferences `hostTeam.email` either way, so both shapes fail identically there, but
 * the JSON is not the same. Declared here so the divergence is visible at the call
 * site rather than hidden inside a cast.
 */
interface MatchFixedNotificationAsPublished {
  matchId: string;
  inviteId: string;
  acceptedTeam: StrippedTeam | null;
  hostTeam: StrippedTeam | null;
  rejectedTeams: Array<StrippedTeam | null>;
  purpose: 'match.fixed';
}

/**
 * The consuming half of the dual-path enrichment. Each handler is the tail of a
 * request/response pair over the bus: this service published a `fetch…` key,
 * identity-service answered on the key handled here.
 *
 * Registered in server.ts via `consumeEvent(queueName, routingKey, handler)`.
 *
 * All three catch their own errors and return normally, which means the shared client
 * acks the message — so the dead-letter queue is unreachable from this service until
 * those internal try/catch blocks are removed. Preserved from the original.
 */
export function createEventHandlers(logger: Logger) {
  /**
   * Answer to `fetchTeamDetails` (published by `createMatch`). Backfills the
   * denormalised team name and college onto the Match — the only mechanism that ever
   * fills them, because `createMatch`'s synchronous lookup is commented out.
   */
  const handleTeamDetailEvent = async (event: EventMap['TeamDetails']): Promise<void> => {
    logger.info('Handling team detail event');
    try {
      const data = event;
      logger.info('Successfully handled team detail event', data);

      const matchId = data.matchId;
      const match = await Match.findById(matchId);
      if (!match) {
        logger.warn('No match found for given match id');
        throw new Error('No match found');
      }
      match.teamName = data.teamName;
      match.collegeName = data.collegeName;
      await match.save();
      logger.info('Updated the match with id ', matchId);
    } catch (err) {
      logger.error(`Error while handling team detail event ${err}`);
    }
  };

  /**
   * Answer to `fetchTeamDetailsForMatchInviteCreated` — the asynchronous fallback for
   * invite creation. Stamps `purpose: 'invite'` onto the team projection it received
   * and republishes it verbatim as a `notification`.
   *
   * This is the ONLY invite path that sets `purpose`, so it is the only one
   * notification-service does not drop on its `default:` branch — but the payload it
   * forwards is a team projection, not the `{sender, receiver}` shape the consumer
   * reads, so `handleInvite` still throws on `hostTeam.email`. Issue 4.
   */
  const handleTeamDetailForMatchInviteEvent = async (
    event: EventMap['TeamDetailsForMatchInvite'],
  ): Promise<void> => {
    logger.info('Handling team detail event for invite');
    try {
      const data = { ...event, purpose: 'invite' as const };
      logger.info('Successfully handled team detail event', data);
      /**
       * D-MT-04 (1 of 3): this payload — the `TeamDetailsForMatchInvite` projection
       * plus a `purpose` — matches NEITHER member of the shared `NotificationEvent`
       * union, which describes `notification` as either the invite shape or the
       * match-fixed shape. Reproducing what is actually sent therefore requires the
       * cast; widening the contract would hide the mismatch instead of recording it.
       * Reported upstream, not patched.
       *
       * Deliberately not awaited, as in the original — the other two handlers await
       * their publish. `publishEvent` reaches `channel.publish` synchronously, so the
       * message is on the wire before the ack either way; the only difference is that
       * a failure surfaces as an unhandled rejection rather than being logged here.
       */
      void publishEvent('notification', data as unknown as NotificationEvent);
      logger.info('Published notification event for match invite');
    } catch (err) {
      logger.error(`Error while handling team detail event ${err}`);
    }
  };

  /**
   * Answer to `fetchTeamDetailsForRespondingToInvite` — the asynchronous fallback for
   * the accept flow. identity-service returns one flat `enrichedTeams` array tagged by
   * role; this regroups it into the `{acceptedTeam, hostTeam, rejectedTeams}` shape
   * notification-service expects and republishes as `notification`.
   *
   * In practice this rarely runs: the synchronous path in `respondToInvite` swallows
   * per-team failures, so its outer catch — which publishes the request that leads
   * here — almost never fires. Issue 10.
   */
  const handleTeamDetailForRespondingToInviteEvent = async (
    event: EventMap['teamDetailsForRespondingToInvite'],
  ): Promise<void> => {
    logger.info('Handling teamDetailsForRespondingToInvite event');

    try {
      // D-MT-07: the original also accepted a raw JSON string here and parsed it. The
      // shared client always hands the handler a parsed object, so that branch was
      // already dead; it is dropped rather than kept as an impossible type test.
      const data = event;
      logger.debug('Incoming event data:', data);

      const { matchId, inviteId, enrichedTeams } = data;

      // Group teams by role
      const grouped = {
        accepted: enrichedTeams.filter((t) => t.role === 'accepted'),
        host: enrichedTeams.filter((t) => t.role === 'host'),
        rejected: enrichedTeams.filter((t) => t.role === 'rejected'),
      };

      // Utility to strip 'role' field
      const stripRole = (team: EnrichedTeam | undefined): StrippedTeam | null => {
        if (!team) return null;
        const { role, ...rest } = team;
        return rest;
      };

      const eventPayload: MatchFixedNotificationAsPublished = {
        matchId,
        inviteId,
        acceptedTeam: grouped.accepted[0] ? stripRole(grouped.accepted[0]) : null,
        hostTeam: grouped.host[0] ? stripRole(grouped.host[0]) : null,
        rejectedTeams: grouped.rejected.map(stripRole),
        purpose: 'match.fixed',
      };

      // See MatchFixedNotificationAsPublished above for why this needs a cast.
      await publishEvent('notification', eventPayload as unknown as MatchFixedNotification);
      logger.info('Published match.fixed event to notification service', eventPayload);
    } catch (err) {
      logger.error(
        `Error handling teamDetailsForRespondingToInvite event: ${(err as Error).message}`,
        err,
      );
    }
  };

  return {
    handleTeamDetailEvent,
    handleTeamDetailForMatchInviteEvent,
    handleTeamDetailForRespondingToInviteEvent,
  };
}
