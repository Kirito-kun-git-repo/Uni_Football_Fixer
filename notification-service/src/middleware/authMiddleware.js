const logger = require('../utils/logger');



const authenticateRequest = async (req, res, next) => {
   

    try{
            const teamId= req.headers['x-team-id']; // Assuming team ID is sent in headers
            if (!teamId) {
                logger.warn(`Acces attempted without team ID`);
                return res.status(401).json({ message: 'Authentication required ! Please Login to continue' });
            }

            req.team = { teamId }; // Attach team ID to request object
            logger.info(`User authenticated with ID: ${teamId}`);
            next();

    }
    catch(error) {
        logger.error('Authentication error:', error);
        res.status(401).json({ message: 'Unauthorized' });
    }
};
module.exports = {authenticateRequest};