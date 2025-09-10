const logger = require('../utils/logger');
const Match=require("../models/Match");
const MatchInvite=require('../models/MatchInvite');
const {publishEvent, consumeEvent}=require('../utils/rabbitmq')
const axios=require('axios');


/*

Endpoints (through API Gateway → Match Service):

POST /v1/invites/:matchId — create invite (challenger → host)

POST /v1/invites/:inviteId/respond — accept/reject

GET /v1/invites/incoming — invites where hostTeamId == me

GET /v1/invites/outgoing — invites where senderTeamId == me
*/


exports.createInvite = async (req, res) => {
  logger.info('Creating an Invite');
  try {
    const matchId = req.params.matchId;
    const match = await Match.findById(matchId);
    

    if (!match) {
      logger.error(`Match not found for id ${matchId}`);
      return res.status(404).json({ message: 'Match not found' });
    }

    const receiverTeamId = match.teamId;

    const senderTeamId = req.team.teamId; // ensure auth middleware sets req.team

    if (!senderTeamId) {
      logger.warn('Missing sender team context (x-team-id / auth)');
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Prevent self-challenge
    if (receiverTeamId.toString() === senderTeamId.toString()) {
      logger.error(`Team ${senderTeamId} cannot challenge itself`);
      return res.status(403).json({ message: 'You cannot challenge yourself' });
    }

    // Create invite in DB (status pending). We create it first to get an inviteId for correlation.
    const newInvite = await MatchInvite.create({
      matchId,
      senderTeamId,
      receiverTeamId,
      status: 'pending',
      note: req.body?.note || null,
      idempotencyKey: req.body?.idempotencyKey || undefined,
    });

    // --- Try to enrich sender/receiver details from IdentityService (parallel, short timeout)
    let sender = { teamId: senderTeamId };
    let receiver = { teamId: receiverTeamId };

    try {
      const TIMEOUT_MS = 700; // short timeout for enrichment
      const [sRes, rRes] = await Promise.allSettled([
        axios.get(`http://localhost:3000/v1/auth/getTeamById/${senderTeamId}`, { timeout: TIMEOUT_MS }),
        axios.get(`http://localhost:3000/v1/auth/getTeamById/${receiverTeamId}`, { timeout: TIMEOUT_MS }),
      ]);

      if (sRes.status === 'fulfilled' && sRes.value?.data) {
        const d = sRes.value.data;
        sender.teamName = d.teamName || d.name || undefined;
        sender.email = d.email || undefined;
        sender.collegeName = d.collegeName || d.collgeName || d.college || undefined;
      } else {
        logger.warn(`Sender enrichment failed: ${sRes.reason?.message || 'no data'}`);
      }

      if (rRes.status === 'fulfilled' && rRes.value?.data) {
        const d = rRes.value.data;
        receiver.teamName = d.teamName || d.name || undefined;
        receiver.email = d.email || undefined;
        receiver.collegeName = d.collegeName || d.collgeName || d.college || undefined;
      } else {
        logger.warn(`Receiver enrichment failed: ${rRes.reason?.message || 'no data'}`);
      }



          const eventPayload = {
          inviteId: newInvite._id.toString(),
          matchId,
          sender,
          receiver,
          status: newInvite.status,
          note: newInvite.note || null,
          createdAt: newInvite.createdAt,
          // purpose:'invite',
          correlationId: newInvite._id.toString(), // handy for tracing
        };

        // Publish event (let rabbit util stringify object)
        await publishEvent('notification', eventPayload);
        logger.info('Published Event: notification for match invite creation', eventPayload);
    } catch (err) {
      logger.warn('Team enrichment attempt failed (caught):', err);
      // await publishEvent("fetchTeamDetails", {
      //   senderTeamId,
      //   matchId: match._id.toString(),
      // });
      await publishEvent("fetchTeamDetailsForMatchInviteCreated", {
        receiverTeamId,
        matchId: match._id.toString(),
      });
      logger.info(
        `Enrichment failed. Now the flow will be from match service to identity service for fetching team details of sender and receiver teams and then receiving them back here and then publishing a notification event`
      );


      

      
      // continue — we will still publish event and invite created
    }

    
    

    return res.status(201).json(newInvite);
  } catch (err) {
    logger.error('Error creating invite', err);
    return res.status(500).json({ message: err.message || 'Internal Server Error' });
  }
};


exports.respondToInvite = async (req, res) => {
  logger.info('Responding to an Invite');
  try {
    const inviteId = req.params.inviteId;
    const response = req.body.response;

    // 🔑 Assume `req.user.teamId` is set by auth middleware
    const currentTeamId = req.team.teamId;
    if (!currentTeamId) {
      return res.status(401).json({ message: 'Unauthorized: teamId missing in token' });
    }

    // Fetch invite (for idempotency + matchId)
    const invite = await MatchInvite.findById(inviteId);
    if (!invite) {
      return res.status(404).json({ message: `No such invite exists with id ${inviteId}` });
    }

    // ✅ Check authorization: only the invited team can respond
    if (invite.receiverTeamId.toString() !== currentTeamId.toString()) {
      return res.status(403).json({ message: 'Forbidden: only the invited team can respond to this invite' });
    }

    // Guard: already accepted/rejected
    if (invite.status !== 'pending') {
      return res.status(409).json({ message: `Invite already ${invite.status}` });
    }

    // Only handle acceptance
    if (response !== 'accepted') {
      return res.status(400).json({ message: `Invalid response: only 'accepted' is allowed` });
    }

    // Accept the chosen invite
    invite.status = 'accepted';
    await invite.save();

    // Update match status → matched
    const match = await Match.findByIdAndUpdate(
      invite.matchId,
      { status: 'matched' },
      { new: true }
    );
    logger.info(`Updating Match Status : Match ${match._id} is fixed`);

    // Reject all other invites for this match
    const otherInvites = await MatchInvite.updateMany(
      { matchId: invite.matchId, _id: { $ne: invite._id }, status: 'pending' },
      { $set: { status: 'rejected' } }
    );
    logger.info(`Rejected ${otherInvites.modifiedCount} other invites`);

    // --- Enrichment (emails + college) ---
    const senderTeamIds = await MatchInvite.find({ matchId: invite.matchId })
      .distinct('senderTeamId');

    const acceptedTeamId = invite.senderTeamId;
    const hostTeamId = match.teamId;
    const rejectedTeamIds = senderTeamIds.filter(id => id !== acceptedTeamId);

    const teamsToEnrich = [
      { teamId: acceptedTeamId, role: 'accepted' },
      { teamId: hostTeamId, role: 'host' },
      ...rejectedTeamIds.map(id => ({ teamId: id, role: 'rejected' }))
    ];

    try {
      logger.info('Fetching Team Details For Respond To Invite syncronously...');
      // throw new Error('Simulating error');
      const enrichedTeams = {};

      for (const { teamId, role } of teamsToEnrich) {
        try {
          const { data } = await axios.get(`http://localhost:3000/v1/auth/getTeamById/${teamId}`);
          enrichedTeams[role] = enrichedTeams[role] || [];
          enrichedTeams[role].push({
            teamId,
            email: data.email,
            collegeName: data.collegeName || data.collgeName || data.college,
            teamName: data.teamName || data.name
          });
        } catch (err) {
          logger.warn(`Enrichment failed for team ${teamId}: ${err.message}`);
          enrichedTeams[role] = enrichedTeams[role] || [];
          enrichedTeams[role].push({ teamId }); // fallback
        }
      }

      // Build event payload
      const eventPayload = {
        matchId: match._id.toString(),
        inviteId: invite._id.toString(),
        acceptedTeam: enrichedTeams.accepted?.[0],
        hostTeam: enrichedTeams.host?.[0],
        rejectedTeams: enrichedTeams.rejected || [],
        purpose: 'match.fixed'
      };

      await publishEvent('notification', eventPayload);
      logger.info('Published match.fixed event', eventPayload);

    } catch (err) {
      logger.warn('Failed to fetch team details synchronously, falling back to async batch:', err);

      // 🔑 Batch event (approach #2)
      await publishEvent("fetchTeamDetailsForRespondingToInvite", {
        matchId: match._id.toString(),
        inviteId: invite._id.toString(),
        purpose: "responding.to.invites",
        teams: teamsToEnrich
      });

      logger.info("Published batched fetchTeamDetails event", {
        matchId: match._id.toString(),
        inviteId: invite._id.toString(),
        teams: teamsToEnrich
      });
    }

    return res.status(200).json({
      message: 'Invite accepted and match fixed',
      matchId: match._id,
      inviteId: invite._id
    });

  } catch (err) {
    logger.error('Error responding to invite', err);
    return res.status(500).json({ message: err.message || 'Internal Server Error' });
  }
};

exports.getIncomingInvites = async (req, res) => {
  logger.info('Getting incoming invites');
  try {
    const currentTeamId = req.team.teamId;
    if (!currentTeamId) {
      return res.status(401).json({ message: 'Unauthorized: teamId missing in token' });
    }
    // Find all invites where receiverTeamId matches the authenticated user's team ID
    const incomingInvites = await MatchInvite.find({ receiverTeamId: currentTeamId }).populate('matchId').exec();
    logger.info(`Found ${incomingInvites.length} incoming invites`);
    return res.json(incomingInvites);
  }
  catch(err){
      logger.error('Error getting incoming invites', err.message);
      return res.status(500).json({ message: 'Internal Server Error'});
    }
}


exports.getOutgoingInvites = async(req,res)=>{
  logger.info('Getting outgoing invites');
  try{
    const currentTeamId=req.team.teamId;
    if(!currentTeamId){
      return res.status(401).json({message:'Unauthorized: teamId missing in token'});
    }
    //Find all invites where senderTeamId matches the authenticated user's team ID
    const outgoingInvites=await MatchInvite.find({senderTeamId:currentTeamId}).populate('matchId').exec();
    logger.info(`Found ${outgoingInvites.length} outgoing invites`);
    return res.json(outgoingInvites);
  }
  catch(err){
    logger.error('Error getting outgoing invites',err.message);
    return res.status(500).json({message:'Internal Server Error'});
  }
}





