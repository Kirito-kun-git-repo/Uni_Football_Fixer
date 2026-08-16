import type { Request, Response } from 'express';
import type { Logger } from '@uff/shared/logger';
import { publishEvent } from '@uff/shared/rabbitmq';
import { Match } from '../models/Match.js';

/** The subset of `GET /v1/auth/getTeamById/:id` this service reads. Shared with the
 *  invite controller's synchronous enrichment path. */
interface TeamLookupResponse {
  teamName?: string;
  collegeName?: string;
}

/**
 * Controllers are built by a factory so the logger is injected rather than imported as
 * a module singleton (matches identity-service, D-ID-05). Called once, from
 * `routes/matchRoutes.ts`.
 */
export function createMatchController(logger: Logger) {
  //fun To Create A New Match
  const createMatch = async (req: Request, res: Response): Promise<void> => {
    logger.info(`Creating a new match`);
    try {
      // Read straight off the header rather than off `req.team`, which
      // `authenticateRequest` also populates from it. Both work; this is what the
      // original did. The middleware has already rejected anything that is not a
      // plain string, so the `!teamId` branch below is unreachable in practice —
      // preserved because it is the documented 400 for this endpoint.
      const teamId = req.headers['x-team-id'] as string | undefined;
      const { matchTime, location } = req.body as { matchTime?: string; location?: string };

      if (!teamId) {
        logger.warn('Missing teamId in headers');
        res.status(400).json({ error: 'TeamId is required' });
        return;
      }

      /**
       * D-05 / backlog item 2 — the synchronous half of the dual-path enrichment.
       *
       * The axios lookup that used to fill `teamData` is commented out in the
       * original and stays that way: `teamData` is therefore always null, the
       * `if (!teamData)` branch below always runs, and `teamName`/`collegeName` are
       * always populated asynchronously by `handleTeamDetailEvent` instead. Collapsing
       * this to a single path is a redesign, not a port.
       */
      // The assertion is what stops TypeScript narrowing this to the `null` literal and
      // then flagging the reads below as unreachable — the point of the declaration is
      // that the type is the wider one the commented-out lookup would have produced.
      const teamData = null as TeamLookupResponse | null;
      // try {
      //   logger.info("Fetching team details synchronously");
      //   const response = await axios.get(
      //     `${env.GATEWAY_URL}/v1/auth/getTeamById/${teamId}`,
      //     { timeout: 0 }
      //   );
      //   teamData = response.data;
      //   logger.info("fetched teamData:", teamData);
      // } catch (err) {
      //   logger.warn("IdentityService lookup failed, will fallback async.", err);
      // }

      const match = await Match.create({
        teamId,
        matchTime,
        location,
        teamName: teamData?.teamName,
        collegeName: teamData?.collegeName,
      });

      // If teamData failed, publish async event. identity-service answers on
      // `TeamDetails`, which this service consumes to backfill the denormalised names.
      if (!teamData) {
        logger.info('Publishing async event for team details');
        await publishEvent('fetchTeamDetails', {
          teamId,
          matchId: match._id.toString(),
        });
      }

      // Always respond to the client — the enrichment above is fire-and-forget, so the
      // 201 body carries `teamName: undefined` until the round-trip lands.
      logger.info('Created match successfully');
      res.status(201).json(match);
    } catch (error) {
      logger.error('Error creating match', (error as Error).message);
      res.status(500).json({ error: 'Failed to create match' });
    }
  };

  // Get all matches (Public Display Board)
  // Unfiltered, unpaginated, every status. Issue 12.
  const getAllMatches = async (_req: Request, res: Response): Promise<void> => {
    logger.info(`Getting All Matches`);
    try {
      const matches = await Match.find();
      res.json(matches);
    } catch (error) {
      logger.error('Error getting all matches', (error as Error).message);
      res.status(500).json({ error: 'failed to get all matches' });
    }
  };

  // Get matches created by the authenticated team (Protected - Requires authentication)
  const getMyMatches = async (req: Request, res: Response): Promise<void> => {
    logger.info(`Getting My Matches`);
    try {
      const teamId = req.headers['x-team-id'] as string | undefined;
      const matches = await Match.find({ teamId: teamId });
      logger.info(`matches`, matches);
      res.json(matches);
    } catch (error) {
      logger.error('Error getting my matches', (error as Error).message);
      res.status(500).json({ error: 'failed to get my matches' });
    }
  };

  // Mounted as `GET /:id`, i.e. the catch-all on this router. It is registered after
  // inviteRoutes in server.ts, which is what stops it shadowing `/get-all-invites`.
  // Returns 200 with a null body for an unknown id rather than 404. Issue 15.
  const getMatchById = async (req: Request, res: Response): Promise<void> => {
    logger.info(`Getting Match By Id`);
    try {
      const id = req.params['id'];
      const match = await Match.findById(id);
      res.json(match);
    } catch (error) {
      logger.error('Error getting match by id', (error as Error).message);
      res.status(500).json({ error: 'failed to get match by id' });
    }
  };

  return { createMatch, getAllMatches, getMyMatches, getMatchById };
}
