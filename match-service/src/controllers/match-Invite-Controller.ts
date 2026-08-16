import type { Request, Response } from 'express';
import axios from 'axios';
import type { Logger } from '@uff/shared/logger';
import { publishEvent } from '@uff/shared/rabbitmq';
import type {
  EnrichedTeam,
  InviteNotification,
  MatchFixedNotification,
  TeamSummary,
} from '@uff/shared/events';
import { env } from '../env.js';
import { Match } from '../models/Match.js';
import { MatchInvite } from '../models/MatchInvite.js';

/*

Endpoints (through API Gateway → Match Service):

POST /v1/invites/:matchId — create invite (challenger → host)

POST /v1/invites/:inviteId/respond — accept/reject

GET /v1/invites/incoming — invites where hostTeamId == me

GET /v1/invites/outgoing — invites where senderTeamId == me
*/

/**
 * What the synchronous enrichment path reads off `GET /v1/auth/getTeamById/:id`.
 *
 * identity-service returns the whole Team document, so in practice only `teamName`,
 * `email` and `collegeName` are ever present — but the original probes `name`,
 * `college` and the misspelled `collgeName` as fallbacks, so those alternatives are
 * typed here rather than dropped. Removing them would change which field wins if
 * identity-service ever narrows its projection.
 */
interface TeamLookupResponse {
  teamName?: string;
  name?: string;
  email?: string;
  collegeName?: string;
  collgeName?: string;
  college?: string;
}

/**
 * Built once by `routes/inviteRoutes.ts`. Holds the invite workflow:
 * challenge → accept → auto-reject everyone else, plus the two enrichment paths that
 * feed notification-service.
 */
export function createInviteController(logger: Logger) {
  const createInvite = async (req: Request, res: Response): Promise<void> => {
    logger.info('Creating an Invite');
    try {
      const matchId = req.params['matchId'] as string;
      const match = await Match.findById(matchId);

      if (!match) {
        logger.error(`Match not found for id ${matchId}`);
        res.status(404).json({ message: 'Match not found' });
        return;
      }

      const receiverTeamId = match.teamId;

      // `authenticateRequest` is mounted globally in server.ts and 401s before this
      // handler runs, so `req.team` is always populated here — the original
      // dereferenced it unguarded, and the `!senderTeamId` check below is therefore
      // unreachable. Both are preserved.
      const senderTeamId = req.team!.teamId; // ensure auth middleware sets req.team

      if (!senderTeamId) {
        logger.warn('Missing sender team context (x-team-id / auth)');
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      // Prevent self-challenge
      if (receiverTeamId.toString() === senderTeamId.toString()) {
        logger.error(`Team ${senderTeamId} cannot challenge itself`);
        res.status(403).json({ message: 'You cannot challenge yourself' });
        return;
      }

      // Create invite in DB (status pending). We create it first to get an inviteId for correlation.
      // `note` and `idempotencyKey` are not schema paths — Mongoose drops both
      // silently, so `idempotencyKey` buys no idempotency at all (D-MT-05). The unique
      // index on {senderTeamId, matchId} is what actually prevents duplicates.
      // Built as a variable rather than inline: Mongoose's typings reject the two
      // non-schema keys as excess properties on an object literal, and dropping them
      // would change what the original passes.
      const invitePayload = {
        matchId,
        senderTeamId,
        receiverTeamId,
        status: 'pending' as const,
        note: (req.body?.note as string | undefined) || null,
        idempotencyKey: (req.body?.idempotencyKey as string | undefined) || undefined,
      };
      const newInvite = await MatchInvite.create(invitePayload);

      // --- Try to enrich sender/receiver details from IdentityService (parallel, short timeout)
      const sender: TeamSummary = { teamId: senderTeamId };
      const receiver: TeamSummary = { teamId: receiverTeamId };

      /**
       * D-05 / backlog item 2 — the synchronous half of the dual-path enrichment.
       *
       * `Promise.allSettled` never rejects, so a failed lookup does NOT reach the
       * catch below: it falls through with `teamName`/`email` left undefined and
       * still publishes `notification`. The only thing that can actually trigger the
       * asynchronous fallback is `publishEvent` itself throwing (issue 6). The two
       * branches are preserved exactly as they are, including that asymmetry.
       */
      try {
        // Was a hardcoded 700 ms, which had to cover two chained network hops and had
        // no headroom under load. Now `env.ENRICHMENT_TIMEOUT_MS` (default 2500),
        // tunable per environment. The two calls still run in parallel, so this is the
        // wall-clock ceiling for the pair, not per call.
        const TIMEOUT_MS = env.ENRICHMENT_TIMEOUT_MS;
        const [sRes, rRes] = await Promise.allSettled([
          axios.get<TeamLookupResponse>(
            `${env.GATEWAY_URL}/v1/auth/getTeamById/${senderTeamId}`,
            { timeout: TIMEOUT_MS },
          ),
          axios.get<TeamLookupResponse>(
            `${env.GATEWAY_URL}/v1/auth/getTeamById/${receiverTeamId}`,
            { timeout: TIMEOUT_MS },
          ),
        ]);

        if (sRes.status === 'fulfilled' && sRes.value?.data) {
          const d = sRes.value.data;
          sender.teamName = d.teamName || d.name || undefined;
          sender.email = d.email || undefined;
          sender.collegeName = d.collegeName || d.collgeName || d.college || undefined;
        } else {
          // `.reason` exists only on a rejected settlement; a fulfilled-but-empty
          // response logs 'no data', exactly as the original did.
          const reason = sRes.status === 'rejected' ? (sRes.reason as Error | undefined) : undefined;
          logger.warn(`Sender enrichment failed: ${reason?.message || 'no data'}`);
        }

        if (rRes.status === 'fulfilled' && rRes.value?.data) {
          const d = rRes.value.data;
          receiver.teamName = d.teamName || d.name || undefined;
          receiver.email = d.email || undefined;
          receiver.collegeName = d.collegeName || d.collgeName || d.college || undefined;
        } else {
          const reason = rRes.status === 'rejected' ? (rRes.reason as Error | undefined) : undefined;
          logger.warn(`Receiver enrichment failed: ${reason?.message || 'no data'}`);
        }

        const eventPayload: InviteNotification = {
          inviteId: newInvite._id.toString(),
          matchId,
          sender,
          receiver,
          status: newInvite.status,
          // D-MT-05: `note` is not a schema path, so reading it back off the created
          // document is always undefined and this is always null.
          note: (newInvite as unknown as { note?: string }).note || null,
          // D-MT-04 (3 of 3): neither is `createdAt` — MatchInvite has `sentAt` and no
          // `timestamps: true` — so this is undefined at runtime and JSON.stringify
          // drops the key from the published message entirely. The shared contract
          // types it as a required string; the cast keeps the runtime value identical
          // without widening the contract. Reported, not patched.
          createdAt: (newInvite as unknown as { createdAt?: string }).createdAt as string,
          // FIXED — this was commented out, and that was the live defect.
          // notification-service switches on `event.purpose`, so without it every
          // invite fell through to its `default:` branch and no email was ever sent
          // along this path.
          purpose: 'invite',
          correlationId: newInvite._id.toString(), // handy for tracing
        };

        // Publish event (let rabbit util stringify object)
        //
        // Order note, because it is load-bearing: notification-service's `handleInvite`
        // was fixed to read `{sender, receiver}` BEFORE this line was uncommented.
        // Uncommenting first would have made a previously-unreachable path reachable
        // and crashed it on `hostTeam.email` for every invite — turning a silent
        // no-op into a downstream error. Consumer first, then reachability.
        await publishEvent('notification', eventPayload);
        logger.info('Published Event: notification for match invite creation', eventPayload);
      } catch (err) {
        logger.warn('Team enrichment attempt failed (caught):', err);
        // The commented-out publish below never matched the `fetchTeamDetails`
        // contract (`{teamId, matchId}`, not `{senderTeamId, matchId}`); left as-is.
        // await publishEvent("fetchTeamDetails", {
        //   senderTeamId,
        //   matchId: match._id.toString(),
        // });
        await publishEvent('fetchTeamDetailsForMatchInviteCreated', {
          receiverTeamId,
          matchId: match._id.toString(),
        });
        logger.info(
          `Enrichment failed. Now the flow will be from match service to identity service for fetching team details of sender and receiver teams and then receiving them back here and then publishing a notification event`,
        );

        // continue — we will still publish event and invite created
      }

      res.status(201).json(newInvite);
    } catch (err) {
      logger.error('Error creating invite', err);
      res.status(500).json({ message: (err as Error).message || 'Internal Server Error' });
    }
  };

  const respondToInvite = async (req: Request, res: Response): Promise<void> => {
    logger.info('Responding to an Invite');
    try {
      const inviteId = req.params['inviteId'] as string;
      const response = (req.body as { response?: string }).response;

      // Set by authenticateRequest from the x-team-id header (never from a token,
      // despite the message below).
      const currentTeamId = req.team!.teamId;
      if (!currentTeamId) {
        res.status(401).json({ message: 'Unauthorized: teamId missing in token' });
        return;
      }

      // Fetch invite (for idempotency + matchId)
      const invite = await MatchInvite.findById(inviteId);
      if (!invite) {
        res.status(404).json({ message: `No such invite exists with id ${inviteId}` });
        return;
      }

      // Check authorization: only the invited team can respond
      if (invite.receiverTeamId.toString() !== currentTeamId.toString()) {
        res
          .status(403)
          .json({ message: 'Forbidden: only the invited team can respond to this invite' });
        return;
      }

      // Guard: already accepted/rejected
      if (invite.status !== 'pending') {
        res.status(409).json({ message: `Invite already ${invite.status}` });
        return;
      }

      // Only handle acceptance. There is no decline path anywhere in the service, and
      // `respondedAt` is never written. Issue 14.
      if (response !== 'accepted') {
        res.status(400).json({ message: `Invalid response: only 'accepted' is allowed` });
        return;
      }

      /**
       * Three separate writes with no session and no transaction (issue 8): a crash
       * between them leaves an accepted invite against an `open` match, or a `matched`
       * match with other invites still `pending`. Preserved — making it transactional
       * requires a replica set, which is an infrastructure change.
       */
      // Accept the chosen invite
      invite.status = 'accepted';
      await invite.save();

      // Update match status → matched
      const match = await Match.findByIdAndUpdate(
        invite.matchId,
        { status: 'matched' },
        { new: true },
      );
      // Unguarded on purpose: `findByIdAndUpdate` returns null if the match was deleted
      // between the invite lookup and here, and the original then threw a TypeError
      // into the outer catch and answered 500. The assertion preserves that exactly.
      logger.info(`Updating Match Status : Match ${match!._id} is fixed`);

      // Reject all other invites for this match
      const otherInvites = await MatchInvite.updateMany(
        { matchId: invite.matchId, _id: { $ne: invite._id }, status: 'pending' },
        { $set: { status: 'rejected' } },
      );
      logger.info(`Rejected ${otherInvites.modifiedCount} other invites`);

      // --- Enrichment (emails + college) ---
      const senderTeamIds = await MatchInvite.find({ matchId: invite.matchId }).distinct(
        'senderTeamId',
      );

      const acceptedTeamId = invite.senderTeamId;
      const hostTeamId = match!.teamId;
      /**
       * D-MT-06: this decides who receives a "your challenge was rejected" email.
       *
       * Both sides are declared `String` in the schemas — `distinct` returns the cast
       * schema values and `invite.senderTeamId` is a string — so `!==` compares by
       * value and the filter is correct today. It would silently start comparing by
       * reference (and reject nobody) if either field were ever changed to an
       * ObjectId. Semantics preserved exactly as written.
       */
      const rejectedTeamIds = senderTeamIds.filter((id) => id !== acceptedTeamId);

      const teamsToEnrich: Array<{ teamId: string; role: string }> = [
        { teamId: acceptedTeamId, role: 'accepted' },
        { teamId: hostTeamId, role: 'host' },
        ...rejectedTeamIds.map((id) => ({ teamId: id, role: 'rejected' })),
      ];

      /**
       * D-05 / backlog item 2 — the synchronous half, again, but shaped differently
       * from `createInvite`'s: sequential rather than parallel, and it publishes WITH
       * `purpose: 'match.fixed'`. It used to carry no timeout either; each call is now
       * bounded by `env.ENRICHMENT_TIMEOUT_MS`.
       *
       * The inner try/catch swallows a failure per team (pushing a `{teamId}`-only
       * fallback), so the outer catch — and with it the batched async path — almost
       * never fires (issue 10). Response latency also grows linearly with the number
       * of invites on the match (issue 9). Both preserved.
       */
      try {
        logger.info('Fetching Team Details For Respond To Invite syncronously...');
        // throw new Error('Simulating error');
        const enrichedTeams: Record<string, EnrichedTeam[]> = {};

        for (const { teamId, role } of teamsToEnrich) {
          try {
            // Previously passed no timeout at all. axios has no default socket
            // timeout, so a single unresponsive gateway hung this loop — and the HTTP
            // client waiting on the accept — indefinitely. Bounded per call now.
            //
            // Note the remaining exposure: these lookups are still SEQUENTIAL, so the
            // worst case is (number of teams x ENRICHMENT_TIMEOUT_MS), not one
            // timeout. Making them concurrent is the rest of issue 9 and is left open.
            const { data } = await axios.get<TeamLookupResponse>(
              `${env.GATEWAY_URL}/v1/auth/getTeamById/${teamId}`,
              { timeout: env.ENRICHMENT_TIMEOUT_MS },
            );
            enrichedTeams[role] = enrichedTeams[role] || [];
            enrichedTeams[role].push({
              teamId,
              email: data.email,
              collegeName: data.collegeName || data.collgeName || data.college,
              teamName: data.teamName || data.name,
            });
          } catch (err) {
            logger.warn(`Enrichment failed for team ${teamId}: ${(err as Error).message}`);
            enrichedTeams[role] = enrichedTeams[role] || [];
            enrichedTeams[role].push({ teamId }); // fallback
          }
        }

        // Build event payload. Unlike createInvite's, this one DOES carry a `purpose`,
        // which is why the accept flow actually produces emails and the invite flow
        // does not.
        const eventPayload: MatchFixedNotification = {
          matchId: match!._id.toString(),
          inviteId: invite._id.toString(),
          acceptedTeam: enrichedTeams['accepted']?.[0],
          hostTeam: enrichedTeams['host']?.[0],
          rejectedTeams: enrichedTeams['rejected'] || [],
          purpose: 'match.fixed',
        };

        await publishEvent('notification', eventPayload);
        logger.info('Published match.fixed event', eventPayload);
      } catch (err) {
        logger.warn('Failed to fetch team details synchronously, falling back to async batch:', err);

        // Batch event (approach #2). identity-service answers on
        // `teamDetailsForRespondingToInvite`, which this service consumes and turns
        // back into a `notification`.
        await publishEvent('fetchTeamDetailsForRespondingToInvite', {
          matchId: match!._id.toString(),
          inviteId: invite._id.toString(),
          purpose: 'responding.to.invites',
          teams: teamsToEnrich,
        });

        logger.info('Published batched fetchTeamDetails event', {
          matchId: match!._id.toString(),
          inviteId: invite._id.toString(),
          teams: teamsToEnrich,
        });
      }

      res.status(200).json({
        message: 'Invite accepted and match fixed',
        matchId: match!._id,
        inviteId: invite._id,
      });
    } catch (err) {
      logger.error('Error responding to invite', err);
      res.status(500).json({ message: (err as Error).message || 'Internal Server Error' });
    }
  };

  const getIncomingInvites = async (req: Request, res: Response): Promise<void> => {
    logger.info('Getting incoming invites');
    try {
      const currentTeamId = req.team!.teamId;
      if (!currentTeamId) {
        res.status(401).json({ message: 'Unauthorized: teamId missing in token' });
        return;
      }
      // Find all invites where receiverTeamId matches the authenticated user's team ID
      const incomingInvites = await MatchInvite.find({ receiverTeamId: currentTeamId })
        .populate('matchId')
        .exec();
      logger.info(`Found ${incomingInvites.length} incoming invites`);
      res.json(incomingInvites);
    } catch (err) {
      logger.error('Error getting incoming invites', (err as Error).message);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  const getOutgoingInvites = async (req: Request, res: Response): Promise<void> => {
    logger.info('Getting outgoing invites');
    try {
      const currentTeamId = req.team!.teamId;
      if (!currentTeamId) {
        res.status(401).json({ message: 'Unauthorized: teamId missing in token' });
        return;
      }
      //Find all invites where senderTeamId matches the authenticated user's team ID
      const outgoingInvites = await MatchInvite.find({ senderTeamId: currentTeamId })
        .populate('matchId')
        .exec();
      logger.info(`Found ${outgoingInvites.length} outgoing invites`);
      res.json(outgoingInvites);
    } catch (err) {
      logger.error('Error getting outgoing invites', (err as Error).message);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  return { createInvite, respondToInvite, getIncomingInvites, getOutgoingInvites };
}
