const logger = require('../utils/logger');
const Match=require("../models/Match");
const MatchInvite=require('../models/MatchInvite');
const {publishEvent}=require('../utils/rabbitmq')
const axios=require('axios');


//fun To Create A New Match
async function createMatch(req, res) {
  logger.info(`Creating a new match`);
  try {
    const teamId = req.headers['x-team-id'];
    const { matchTime, location } = req.body;

    if (!teamId) {
      logger.warn("Missing teamId in headers");
      return res.status(400).json({ error: "TeamId is required" });
    }

    let teamData = null;
    // try {
    //   logger.info("Fetching team details synchronously");
    //   const response = await axios.get(
    //     `http://localhost:3000/v1/auth/getTeamById/${teamId}`,
    //     { timeout: 0 }
    //   );
    //   teamData = response.data;
    //   logger.info("fetched teamData:", teamData);
    // } catch (err) {
    //   logger.warn("IdentityService lookup failed, will fallback async.", err);
    // }

    // ✅ Create match
    const match = await Match.create({
      teamId,
      matchTime,
      location,
      teamName: teamData?.teamName,
      collegeName: teamData?.collegeName,
    });

    // If teamData failed, publish async event
    if (!teamData) {
      logger.info("Publishing async event for team details");
      await publishEvent("fetchTeamDetails", {
        teamId,
        matchId: match._id.toString(),
      });
    }

    // ✅ Always respond to client
    logger.info("Created match successfully");
    return res.status(201).json(match);

  } catch (error) {
    logger.error("Error creating match", error.message);
    return res.status(500).json({ error: "Failed to create match" });
  }
}

/*


// Update a match by ID (Protected)
router.put('/:id', authenticateToken, matchController.updateMatch);
// Delete a match by ID (Protected)
router.delete('/:id', authenticateToken, matchController.deleteMatch);



*/


// Get all matches (Public Display Board)

async function getAllMatches(req,res){
logger.info(`Getting All Matches`);
    try{
        let matches=await Match.find();
        return res.json(matches);
    }catch(error){
        logger.error("Error getting all matches",error.message);
        return res.status(500).json({error:"failed to get all matches"});
    }
}


// Get matches created by the authenticated team (Protected - Requires authentication)
async function getMyMatches(req,res){
    logger.info(`Getting My Matches`);
    try{
        const teamId=req.headers["x-team-id"];
        let matches=await Match.find({teamId:teamId});
        logger.info(`matches`,matches);
        return res.json(matches);
    }catch(error){
        logger.error("Error getting my matches",error.message);
        return res.status(500).json({error:"failed to get my matches"});
    }
}

async function getMatchById(req,res){
    logger.info(`Getting Match By Id`);
    try{
        const id=req.params.id;
        let match=await Match.findById(id);
        return res.json(match);
    }catch(error){
        logger.error("Error getting match by id",error.message);
        return res.status(500).json({error:"failed to get match by id"});
    }
}


//

module.exports={createMatch,getAllMatches,getMyMatches,getMatchById}




