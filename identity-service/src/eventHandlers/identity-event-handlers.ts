import type { Logger } from '@uff/shared/logger';
import { publishEvent } from '@uff/shared/rabbitmq';
import type { EventMap, EnrichedTeam, TeamDocumentPayload } from '@uff/shared/events';
import { Team } from '../models/Team.js';

/**
 * identity-service is the enrichment authority: it owns the Team collection, so every
 * other service asks it for team details over the bus rather than reading the database.
 *
 * Each handler is registered in server.ts via consumeEvent(queueName, routingKey, handler).
 *
 * All four handlers catch their own errors and return normally — meaning the shared
 * client acks the message. Preserved from the original, but note the consequence:
 * the new dead-letter queue is unreachable from this service until the internal
 * try/catch blocks are removed. Backlog item 14.
 */
export function createEventHandlers(logger: Logger) {
  /** media-service published a new logo URL; write it onto the Team. */
  const handleProfileUploadEvent = async (
    event: EventMap['profilePhoto.updated'],
  ): Promise<void> => {
    logger.info('Handling profile upload event', event);
    const { teamId, url } = event;
    try {
      const team = await Team.findById(teamId);
      if (!team) {
        logger.error(`No team found for id ${teamId}`);
        return;
      }
      // Triggers Team's pre-save hook, but `isModified('password')` is false here,
      // so the already-hashed password is not re-hashed.
      team.logoUrl = url;
      await team.save();
      logger.info(`Updated url of team with id ${teamId}`);
    } catch (err) {
      logger.error(`Error updating logo url of team with id ${teamId}`, err);
    }
  };

  /**
   * match-service asked for a team document to denormalise onto a Match.
   *
   * A-1: `.select('-password')` is load-bearing. This handler previously published
   * `result.toObject()` whole, so the argon2 hash travelled the bus and was logged
   * verbatim by the consumer on the other side. Projecting at the query means the
   * value never enters the process, rather than being deleted from an object that
   * already holds it — there is no window and nothing to forget.
   *
   * Only `teamName` and `collegeName` are actually read downstream.
   */
  const handleTeamDetailEvent = async (event: EventMap['fetchTeamDetails']): Promise<void> => {
    logger.info('Handling team detail event', event);
    try {
      const { teamId, matchId } = event;
      const result = await Team.findById(teamId).select('-password');
      if (!result) {
        logger.error(`No team found for id ${teamId}`);
        throw new Error(`No team found for id ${teamId}`);
      }

      const teamObj = result.toObject() as unknown as TeamDocumentPayload;
      await publishEvent('TeamDetails', { ...teamObj, matchId });
      logger.info(`Published team details of team with id ${teamId}`);
    } catch (err) {
      logger.error(`Error handling team detail event: ${(err as Error).message}`);
    }
  };

  /**
   * Async fallback path for invite creation — reached only when match-service's
   * synchronous axios enrichment throws. Returns a projection, not the whole document,
   * which is why the payload shape differs from `TeamDetails`. Backlog item 2.
   */
  const handleTeamDetailForMatchInviteEvent = async (
    event: EventMap['fetchTeamDetailsForMatchInviteCreated'],
  ): Promise<void> => {
    logger.info('Handling team detail for match Invite event', event);
    try {
      const { receiverTeamId, matchId } = event;
      const result = await Team.findById(receiverTeamId).select('teamName email collegeName');
      if (!result) {
        logger.error(`No team found for id ${receiverTeamId}`);
        throw new Error(`No team found for id ${receiverTeamId}`);
      }

      const teamObj = result.toObject();
      await publishEvent('TeamDetailsForMatchInvite', {
        _id: String(teamObj._id),
        teamName: teamObj.teamName,
        email: teamObj.email,
        collegeName: teamObj.collegeName,
        matchId,
      });
      logger.info(`Published team details of team with id ${receiverTeamId}`);
    } catch (err) {
      logger.error(`Error handling team detail event: ${(err as Error).message}`);
    }
  };

  /**
   * Batch enrichment for the accept-invite flow. Looks up host, accepted, and every
   * rejected team in one pass.
   *
   * A team that cannot be found is pushed with an `error` field rather than omitted,
   * so the consumer's array stays aligned with the request order.
   */
  const handleTeamDetailForRespondingToInviteEvent = async (
    event: EventMap['fetchTeamDetailsForRespondingToInvite'],
  ): Promise<void> => {
    logger.info('Received fetchTeamDetailsForRespondingToInvite event', event);
    try {
      const { matchId, inviteId, purpose, teams } = event;
      if (!teams || !Array.isArray(teams)) {
        throw new Error("Invalid payload: 'teams' must be an array");
      }

      const enriched: EnrichedTeam[] = [];
      for (const { teamId, role } of teams) {
        try {
          const team = await Team.findById(teamId);
          if (!team) {
            logger.warn(`No team found for id ${teamId}`);
            enriched.push({ teamId, role, error: 'Not found' });
            continue;
          }
          enriched.push({
            teamId,
            role,
            email: team.email,
            collegeName: team.collegeName,
            teamName: team.teamName,
          });
        } catch (err) {
          logger.error(`Error enriching team ${teamId}: ${(err as Error).message}`);
          enriched.push({ teamId, role, error: (err as Error).message });
        }
      }

      await publishEvent('teamDetailsForRespondingToInvite', {
        matchId,
        inviteId,
        purpose,
        enrichedTeams: enriched,
      });
      logger.info('Published teamDetailsForRespondingToInvite');
    } catch (err) {
      logger.error('Error handling fetchTeamDetailsForRespondingToInvite', err);
    }
  };

  return {
    handleProfileUploadEvent,
    handleTeamDetailEvent,
    handleTeamDetailForMatchInviteEvent,
    handleTeamDetailForRespondingToInviteEvent,
  };
}
