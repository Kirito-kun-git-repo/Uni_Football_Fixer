require('dotenv').config();
const express = require('express');
const cors=require('cors');
const Redis = require('ioredis');
const helmet = require('helmet');
const {rateLimit}=require('express-rate-limit');
const {RedisStore}=require('rate-limit-redis');
const logger = require('./utils/logger');
const proxy = require('express-http-proxy');
const errorHandler = require('./middleware/errorhandler');
const { validateToken } = require('./middleware/authMiddleware');





const app=express();
const PORT=process.env.PORT || 3000;

const redisClient = new Redis(process.env.REDIS_URL);


app.use(helmet());
app.use(cors());
app.use(express.json());

//rate limiting middleware

const ratelimit=rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max :100,
    standardHeaders:true,
    legacyHeaders:false,
    handler : (req, res) => {
        logger.warn(`Sensitive endpoint rate limit exceeded for ip: ${req.ip}`);
        res.status(429).json({message: 'Too many requests, please try again later.'});
        
    },
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    }),
});


app.use(ratelimit);

app.use((req, res, next) => {
    logger.info(`  Recieved ${req.method} Request to  ${req.url}`);
    logger.info(`Request Body ${req.body}`);
    next();
}
);
app.set("trust proxy", 1);


const proxyOptions = {
    proxyReqPathResolver: (req) => {
        return req.originalUrl.replace(/^\/v1/,'/api')
    },
    proxyErrorHandler: (err, res, next) => {
        logger.error(`Proxy error: ${err.message}`);
        res.status(500).json({ message: 'Internal Server Error' });
    },
}

//setting up proxy for identity service
app.use('/v1/auth',proxy(process.env.IDENTITY_SERVICE_URL, {
    ...proxyOptions,
    //   https: true,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        proxyReqOpts.headers['Content-Type'] = "application/json";
        return proxyReqOpts;
    },  
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
        logger.info(`Received response from identity service : ${proxyRes.statusCode}`);
        return proxyResData;
    }
}));



// //setting up proxy for Post-service
// app.use('/v1/posts',validateToken,proxy(process.env.POST_SERVICE_URL,{
//     ...proxyOptions,
//      https: true,
//     proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
//         proxyReqOpts.headers['Content-Type'] = "application/json";
//         proxyReqOpts.headers['x-team-id'] = srcReq.team.teamId; // Attach team ID from token
//         return proxyReqOpts;
//     },
//     userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
//         logger.info(`Received response from post service : ${proxyRes.statusCode}`);
//         return proxyResData;
//     }
// }))


//setting up proxy for media service
app.use('/v1/media', validateToken, proxy(process.env.MEDIA_SERVICE_URL, {
    ...proxyOptions,
    //  https: true,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        proxyReqOpts.headers['x-team-id'] = srcReq.team.teamId;
        if(!srcReq.headers['content-type'].startsWith('multipart/form-data')) {
            proxyReqOpts.headers['Content-Type'] = "application/json";
        }
        return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
        logger.info(`Received response from media service : ${proxyRes.statusCode}`);
        return proxyResData;
    }
}));


//setting up proxy for match-service
app.use('/v1/match', validateToken, proxy(process.env.MATCH_SERVICE_URL, {
    ...proxyOptions,
    //  https: true,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        proxyReqOpts.headers['x-team-id'] = srcReq.team.teamId;
        logger.info(srcReq.team.teamId);
        proxyReqOpts.headers['Content-Type'] = "application/json";
        return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
        logger.info(`Received response from match service : ${proxyRes.statusCode}`);
        return proxyResData;
    }
}));



// //setting up proxy for search service
// app.use('/v1/search',validateToken,proxy(process.env.SEARCH_SERVICE_URL,{
//     ...proxyOptions,
//      https: true,
//     proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
//         proxyReqOpts.headers['Content-Type'] = "application/json";
//         proxyReqOpts.headers['x-team-id'] = srcReq.team.teamId; // Attach team ID from token
//         return proxyReqOpts;
//     },
//     userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
//         logger.info(`Received response from search service : ${proxyRes.statusCode}`);
//         return proxyResData;
//     }
// }))




app.use(errorHandler);
app.listen(PORT, () => {
    logger.info(`API Gateway is running on port ${PORT}`);
    logger.info(`Identity Service URL:, ${process.env.IDENTITY_SERVICE_URL}`);
    // logger.info(`Post Service URL:' ${ process.env.POST_SERVICE_URL}`);
    logger.info(`Media Service URL ${process.env.MEDIA_SERVICE_URL}`);
    logger.info(`Match Service URL ${process.env.MATCH_SERVICE_URL}`);

    logger.info(`Redis URL:', ${process.env.REDIS_URL}`);
});