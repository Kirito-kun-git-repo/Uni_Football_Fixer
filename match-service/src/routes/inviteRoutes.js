const express = require('express');
const router = express.Router();
const logger=require("../utils/logger");
const inviteController = require('../controllers/match-Invite-Controller');

logger.info("Invites routes loaded");
router.post('/send-invite/:matchId', inviteController.createInvite);
router.post('/respond-to-invites/:inviteId',inviteController.respondToInvite);
router.get('/get-all-invites/',inviteController.getIncomingInvites);
router.get('/get-outgoing-invites/',inviteController.getOutgoingInvites);

module.exports = router;