const logger=require('../utils/logger');
const Match=require('../models/Match');
const { publishEvent } = require('../utils/rabbitmq');

async function handleTeamDetailEvent(event){
    logger.info('Handling team detail event');
    try{
        let data=event;
        logger.info('Successfully handled team detail event',data);

        const matchId=data.matchId;
        const match=await Match.findById(matchId);
        if(!match){
            logger.warn('No match found for given match id');
            throw new Error('No match found');
        }
        match.teamName=data.teamName;
        match.collegeName=data.collegeName;
        await match.save();
        logger.info('Updated the match with id ',matchId);





    }
    catch(err){
        logger.error(`Error while handling team detail event ${err}`);
        
    }
}
async function handleTeamDetailForMatchInviteEvent(event){
    logger.info('Handling team detail event for invite');
    try{
        let data=event;
        console.log(typeof(data));
        data.purpose='invite';
        logger.info('Successfully handled team detail event',data);
        publishEvent('notification',data);
        logger.info('Published notification event for match invite');


    }
    catch(err){
        logger.error(`Error while handling team detail event ${err}`);
    }
}

async function handleTeamDetailForRespondingToInviteEvent(event) {
  logger.info("Handling teamDetailsForRespondingToInvite event");

  try {
    const data = typeof event === "string" ? JSON.parse(event) : event;
    logger.debug("Incoming event data:", data);

    const { matchId, inviteId, enrichedTeams } = data;

    // Group teams by role
    const grouped = {
      accepted: enrichedTeams.filter(t => t.role === "accepted"),
      host: enrichedTeams.filter(t => t.role === "host"),
      rejected: enrichedTeams.filter(t => t.role === "rejected"),
    };

    // Utility to strip 'role' field
    const stripRole = team => {
      if (!team) return null;
      const { role, ...rest } = team;
      return rest;
    };

    const eventPayload = {
      matchId,
      inviteId,
      acceptedTeam: grouped.accepted[0] ? stripRole(grouped.accepted[0]) : null,
      hostTeam: grouped.host[0] ? stripRole(grouped.host[0]) : null,
      rejectedTeams: grouped.rejected.map(stripRole),
      purpose: "match.fixed",
    };

    await publishEvent("notification", eventPayload);
    logger.info("Published match.fixed event to notification service", eventPayload);
  } catch (err) {
    logger.error(
      `Error handling teamDetailsForRespondingToInvite event: ${err.message}`,
      err
    );
  }
}


module.exports={
    handleTeamDetailEvent,
    handleTeamDetailForMatchInviteEvent,
    handleTeamDetailForRespondingToInviteEvent
}