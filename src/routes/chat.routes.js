const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const passport = require('passport');
const Team = require('../models/team.model');

// Middleware to authenticate JWT token
const authenticate = passport.authenticate('jwt', { session: false });

// Get chat history for a match
router.get('/matches/:matchId', chatController.getChatHistory);

// Send a message in a match chat
router.post('/matches/:matchId', chatController.sendMessage);

module.exports = router;
