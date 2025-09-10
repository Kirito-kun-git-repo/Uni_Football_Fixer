const dotenv=require('dotenv').config();
const mongoose = require('mongoose');
const logger= require('./utils/logger');
const express=require('express');
const app=express();
const helmet= require('helmet');
const cors = require('cors');
const {RateLimiterRedis}=require('rate-limiter-flexible');
const Redis=require('ioredis');
const {rateLimit}=require('express-rate-limit');
const {RedisStore}=require('rate-limit-redis');
const matchroutes=require('./routes/matchRoutes.js');
const errorHandler = require('./middleware/errorHandler');
const { createClient } = require('redis');
const {connectToRabbitMQ,consumeEvent}=require("./utils/rabbitmq");
const { handleTeamDetailEvent,handleTeamDetailForMatchInviteEvent,handleTeamDetailForRespondingToInviteEvent } = require('./eventHandlers/match-event-handlers.js');
const inviteRoutes=require('./routes/inviteRoutes.js');
const {authenticateRequest}=require('./middleware/authMiddleware');









//connect to MongoDB
mongoose
    .connect(process.env.MONGODB_URL)
    .then(() => {
        logger.info('Connected to MongoDB');
        })
    .catch((err) => {
        logger.error('Error connecting to MongoDB:', err);});

//connect to redis
// const redisClient=new Redis({
//      host: process.env.REDIS_HOST,
//      port: process.env.REDIS_PORT,
//      password: process.env.REDIS_PASSWORD,
// });
const redisClient = new Redis({
   url : process.env.REDIS_URL
})
// const redisClient=createClient({
//     url:process.env.REDIS_URL
// });
redisClient.on('connect', () => {
    logger.info('Connected to Redis');
});
redisClient.on('error', (err) => {
    logger.error('Error connecting to Redis:', err);
})






//middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    logger.info(`  Recieved ${req.method} Request to  ${req.url}`);
    logger.info(`Request Body ${req.body}`);
    next();
}
);

//DDos Protection
const rateLimiter = new  RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rateLimiter',
    points: 5, // 5 requests
    duration: 1, // per minute
})
// app.use((req, res, next) => {
//     rateLimiter.consume(req.ip)
//         .then(() => next())
//         .catch(() => {
//             logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
//             res.status(429).json({ message: 'Too many requests, please try again later.' });
//         });
//     });



//Ip based rate limiting for sensitive routes/endpoints
// const sensitiveRateLimiter =rateLimit({
//     windowMs: 1*30*1000, // 15 minutes
//     max :1,
//     standardHeaders:true,
//     legacyHeaders:false,
//     handler : (req, res) => {
//         logger.warn(`Sensitive endpoint rate limit exceeded for ip: ${req.ip}`);
//         res.status(429).json({message: 'Too many requests, please try again later.'});
        
//     },
//     store: new RedisStore({
//         sendCommand: async (...args) => redisClient.sendCommand(args),
//     }),
// });










// const sensitiveRateLimiter = rateLimit({
//   windowMs: 30 * 1000, // 30s
//   max: 1,
//   standardHeaders: true,
//   legacyHeaders: false,
//   store: new RedisStore({
//     sendCommand: (...args) => redisClient.sendCommand(args),
//   }),
// });







// // apply this to sensitive routes/endpoints
// app.use('/api/sensitive', sensitiveRateLimiter);


// const sensitiveRateLimiter = new RateLimiterRedis({
//   storeClient: redisClient,
//   keyPrefix: 'sensitive',
//   points: 10000, // 1000 request
//   duration: 30, // per 30 seconds
// });

// app.use(async (req, res, next) => {
//   try {
//     await sensitiveRateLimiter.consume(req.ip);
//     next();
//   } catch {
//     logger.warn(`Sensitive endpoint rate limit exceeded for ip: ${req.ip}`);
//     res.status(429).json({ message: 'Too many requests, please try again later.' });
//   }
// });


















logger.info("sensitive route applied");

//routes
// app.use('/api/match', (req, res, next) => {
//   logger.info("➡️ Entering /api/match routes");
//   next();
// });
app.use(authenticateRequest);
app.use('/api/match', inviteRoutes);
app.use('/api/match', matchroutes);
console.log("match route applied");



logger.info("match route applied");
//
//error handling middleware

app.use(errorHandler);
// app.listen(process.env.PORT || 3001, () => {
//     logger.info(`Server is running on port ${process.env.PORT || 3001}`);
// }
// );
const startServer = async () => {
  try {
    // await redisClient.connect(); // 🔑 required

    logger.info("Connected to Redis");
    await connectToRabbitMQ();
    logger.info('RabbitMQ connection established successfully');


    await consumeEvent('TeamDetails',handleTeamDetailEvent);
    await consumeEvent('TeamDetailsForMatchInvite',handleTeamDetailForMatchInviteEvent)
    await consumeEvent('teamDetailsForRespondingToInvite',handleTeamDetailForRespondingToInviteEvent)



    app.listen(process.env.PORT || 3004, () => {
      logger.info(`Server is running on port ${process.env.PORT || 3004}`);
    });
  } catch (err) {
    logger.error("Error starting server:", err);
    process.exit(1);
  }
};

startServer();


//unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', promise,"reason:", reason);
   
});



   