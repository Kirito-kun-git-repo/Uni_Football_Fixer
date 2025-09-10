const logger =require('../utils/logger')
const Team = require('../models/Team');
const { publishEvent } = require('../utils/rabbitmq');



async function handleProfileUploadEvent(event){
    logger.info('Handling profile upload event',event)
    const {teamId,url}=event;
    try{
            const team=await Team.findById(teamId);
            if(!team){
                logger.error(`No team found for id ${teamId}`)
                return;
            }
            logger.info(`Updating team with id ${teamId}`)
            team.logoUrl=url;
            await team.save();
            logger.info(`Updated url of team with id ${teamId}`)
    }
    catch(err){
        logger.error(`Error updating logo url of team with id ${teamId}`,err)
    }
    

}

async function handleTeamDetailEvent(event) {
    logger.info('Handling team detail event', event);
    try {
        const { teamId, matchId } = event;
        const result = await Team.findById(teamId);

        if (!result) {
            logger.error(`No team found for id ${teamId}`);
            throw new Error(`No team found for id ${teamId}`);
        }

        // convert to plain object
        const teamObj = result.toObject();
        teamObj.matchId = matchId;

        // publish clean object
        logger.info("got here",teamObj);
        await publishEvent("TeamDetails", teamObj);

        logger.info(teamObj);
        logger.info(`Published team details of team with id ${teamId}`);
    } catch (err) {
        logger.error(`Error handling team detail event: ${err.message}`);
    }
}


async function handleTeamDetailForMatchInviteEvent(event) {
    logger.info('Handling team detail for match Invite event', event);
    try {
        const { receiverTeamId, matchId } = event;
        const result = await Team.findById(receiverTeamId)
                        .select('teamName email collegeName');

        if (!result) {
            logger.error(`No team found for id ${receiverTeamId}`);
            throw new Error(`No team found for id ${receiverTeamId}`);
        }

        // convert to plain object
        const teamObj = result.toObject();
        teamObj.matchId = matchId;

        // publish clean object
        logger.info("got here",teamObj);
        await publishEvent("TeamDetailsForMatchInvite", teamObj);

        logger.info(teamObj);
        logger.info(`Published team details of team with id ${receiverTeamId}`);
    } catch (err) {
        logger.error(`Error handling team detail event: ${err.message}`);
    }
}
async function handleTeamDetailForRespondingToInviteEvent(event) {
  logger.info("Received fetchTeamDetailsForRespondingToInvite event", event);

  try {
    const { matchId, inviteId, purpose, teams } = event;

    if (!teams || !Array.isArray(teams)) {
      throw new Error("Invalid payload: 'teams' must be an array");
    }

    const enriched = [];

    for (const { teamId, role } of teams) {
      try {
        const team = await Team.findById(teamId);

        if (!team) {
          logger.warn(`No team found for id ${teamId}`);
          enriched.push({ teamId, role, error: "Not found" });
          continue;
        }

        enriched.push({
          teamId,
          role,
          email: team.email,
          collegeName: team.collegeName,
          teamName: team.teamName
        });
      } catch (err) {
        logger.error(`Error enriching team ${teamId}: ${err.message}`);
        enriched.push({ teamId, role, error: err.message });
      }
    }

    // Build response event
    const responsePayload = {
      matchId,
      inviteId,
      purpose, // "responding.to.invites"
      enrichedTeams: enriched
    };

    await publishEvent("teamDetailsForRespondingToInvite", responsePayload);

    logger.info("Published teamDetailsForRespondingToInvite", responsePayload);

  } catch (err) {
    logger.error("Error handling fetchTeamDetailsForRespondingToInvite", err);
  }
};


module.exports={
    handleProfileUploadEvent,
    handleTeamDetailEvent,
    handleTeamDetailForMatchInviteEvent,
    handleTeamDetailForRespondingToInviteEvent
    
}