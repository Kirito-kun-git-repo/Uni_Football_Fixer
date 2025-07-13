const express = require('express');
const router = express.Router();
const inviteController = require('../controllers/invite.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

// Create a new match invite
router.post('/:matchId', authenticateToken, inviteController.createInvite);

// Get all invites for a specific match (for match creator)
router.get('/match/:matchId', authenticateToken, inviteController.getInvitesForMatch);

// Get all invites sent by the authenticated team
router.get('/sent', authenticateToken, inviteController.getSentInvites);

// Get all invites received by the authenticated team
router.get('/received', authenticateToken, inviteController.getReceivedInvites);

// Accept a match invite
router.put('/:inviteId/accept', authenticateToken, inviteController.acceptInvite);

module.exports = router;
