
const logger=  require('../utils/logger');
const Team = require('../models/Team');
// const RefreshToken = require('../models/RefreshToken');
const {validateRegistration, validateLogin}=require('../utils/validation');
const generateToken = require('../utils/generateToken');
const RefreshToken = require('../models/RefreshToken');


//team registration

const registration=async(req, res) => {
    logger.info('Team registration started');
    try{
        const {error} = validateRegistration(req.body);
        if (error) {
            logger.warn('Validation error:', error.details[0].message);
            return res.status(400).json({ message: error.details[0].message });
        }

        const {email , password, teamName,collegeName} = req.body;
        let team = await Team.findOne({ $or: [{ email },{teamName}]});
        if(team){
             logger.warn('Team Already Exist');
             return res.status(400).json({ message: "Team Already Exist" });

        }
        team = new Team({ email, password, collegeName, teamName });
        await team.save();
        logger.info('Team Saved Successfully', team._id);
        const { accesstoken, refreshtoken}= await generateToken(team);
        res.status(201).json({
            message: "Team Registered Successfully",
            accesstoken,
            refreshtoken,
        });




    }catch(err){
        logger.error('Error during registration:', err);
        res.status(500).json({ message: "Internal Server Error" });
       
       


    }
}

//team login
const loginUser =async (req,res) => {
    logger.info('Team Login started');
    try{
        const {error} = validateLogin(req.body);
        if( error) {
            logger.warn('Validation error:', error.details[0].message);
            return res.status(400).json({ message: error.details[0].message });
        }
        const {email, password} = req.body;
        const team = await Team.findOne({email});
        if(!team){
            logger.warn('Team Not Found');
            return res.status(404).json({ message: "Team Not Found" });
        }
        //valid Team checking password
        const isValidPassword = await team.comparePassword(password);
         if(!isValidPassword){
            logger.warn('Password is not valid');
            return res.status(404).json({ message: "Invalid Password" });
        }

        const {accesstoken,refreshtoken}=await generateToken(team);
        res.json({
            accesstoken,
            refreshtoken,
            team : team._id,
            message: "Team Logged In Successfully"
        })


    }catch(err){
        logger.error('Error during login:', err);
        res.status(500).json({ message: "Internal Server Error" });

    }
}


//Refresh Token
const refreshTokenUser = async (req, res) => {
    logger.info('Refresh Token started');
    try { 
        const { refreshtoken } = req.body;
        if(!refreshtoken) {
            logger.warn('Refresh token is missing');
            return res.status(400).json({ message: "Refresh token is missing" });
        }

        const storedToken = await RefreshToken.findOne({  token :refreshtoken});
        if(!storedToken || storedToken.expiresAt <new Date()) {
            logger.warn('Invalid or expired refresh token');
            return res.status(400).json({ message: "Invalid or expired refresh token" });
        }
        const team= await Team.findOne(storedToken.team);
        if(!team){
            logger.warn('Team not found for the refresh token');
            return res.status(404).json({ message: "Team not found" });
        }
        const { accesstoken :newAccesstoken, refreshtoken : newRefreshToken } = await generateToken(team);
         //delete the old token
        await RefreshToken.deleteOne({ _id: storedToken._id });

        res.json({
            accesstoken: newAccesstoken,
            refreshtoken: newRefreshToken,
            message: "Tokens refreshed successfully"
        })


    }catch (err) {
        logger.error('Error during refresh token:', err);
        res.status(500).json({ message: "Internal Server Error" });
    }
}



//logout
const logoutUser=async (req,res)=>{
    logger.info('Team logout Endpoint hit');
    try{

        const { refreshtoken } = req.body;
        if(!refreshtoken) {
            logger.warn('Refresh token is missing');
            return res.status(400).json({ message: "Refresh token is missing" });
        }
        await RefreshToken.deleteOne({ token: refreshtoken });
        logger.info('Team logged out successfully');
        res.status(200).json({ message: "Team logged out successfully" });

    }catch(err){
        logger.error('Error during logout:', err);
        res.status(500).json({ message: "Internal Server Error" });
    }
}

async function getTeamById(req,res){
    logger.info(`Fetching team with ID ${req.params.teamId}`);
    try{
        const teamId=req.params.teamId;
        const team = await Team.findById(teamId);
        if (!team) {
            logger.warn(`Team with ID ${teamId} not found`);
            return res.status(404).json({ message: 'Team not found' });
          }
        return res.status(200).json(team);
    }
    catch(error){
        logger.error(`Error fetching team with ID ${id}:`, error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}


module.exports = {
    registration,
    loginUser,
    refreshTokenUser,
    logoutUser,
    getTeamById
};
