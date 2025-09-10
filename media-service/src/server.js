const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const logger = require('./utils/logger');
const cors = require('cors');
const helmet = require('helmet');
const mediaRoutes = require('./routes/media-routes');
const redis = require('redis');
const errorHandler = require('./middleware/errorHandler');

const { createClient } = require('redis');
const rateLimit = require('express-rate-limit');
const {RedisStore} = require('rate-limit-redis');
const { connectToRabbitMQ, consumeEvent } = require('./utils/rabbitmq');
const { handlePostDeleted } = require('./eventHandlers/media-event-handlers');





const app = express();
const PORT= process.env.PORT || 3003;
mongoose.connect(process.env.MONGODB_URL)
.then(() => {
    logger.info('Connected to MongoDB');
})
.catch((error) => {
    logger.error('Error connecting to MongoDB:', error);
});




const redisClient =  createClient({
    url: process.env.REDIS_URL
});
redisClient.connect();
redisClient.on('connect', () => {
    logger.info('Connected to Redis');
});
redisClient.on('error', (err) => {
    logger.error('Redis error:', err);
}); 


app.use(cors());
app.use(helmet());
app.use(express.json());
app.use((req, res, next) => {
    logger.info(`  Recieved ${req.method} Request to  ${req.url}`);
    logger.info(`Request Body ${req.body}`);
    next();
}
);

const sensitiveRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 50, // Limit each IP to 5 requests per minute
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler : (req,res)=>{
        logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({ message: 'Too many requests, please try again later.' });
    },
    store: new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
    })
        
});

//routes
app.use('/api/media', sensitiveRateLimiter);
app.use('/api/media', mediaRoutes);

app.use(errorHandler);


async function startServer() {
    try {
        await connectToRabbitMQ();
        logger.info('RabbitMQ connection established successfully');


        // await consumeEvent('post.deleted',handlePostDeleted);
        app.listen(PORT, () => {
        logger.info(`Media service is running on port ${PORT}`);
        });
    } catch (error) {
        logger.error('Error connecting to RabbitMQ:', error);
        process.exit(1); // Exit the process if RabbitMQ connection fails
    }
}
startServer();

// app.listen(PORT, () => {
//     logger.info(`Media service is running on port ${PORT}`);
// });


process.on('unhandledRejection', (error) => {
    logger.error('Unhandled Rejection:', error);
});
