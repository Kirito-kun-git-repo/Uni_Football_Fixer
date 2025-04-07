const express = require('express');
const router = express.Router();
const passport = require('passport');
const mongoose = require('mongoose');

const Match = require('../models/match.model');
const MatchInvite = require('../models/matchInvite.model');
const Notification = require('../models/notification.model');
const { sendMatchInviteEmail, sendMatchAcceptanceEmail } = require('../utils/email');
const Team = require('../models/team.model');

// Middleware to authenticate JWT token
const authenticate = passport.authenticate('jwt', { session: false });

// Create a new match invite
router.post('/:matchId', authenticate, async (req, res) => {
  try {
    const { matchId } = req.params;
    const senderTeamId = req.user._id; // From JWT token

    // Validate matchId format
    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Invalid match ID format' });
    }

    // Fetch the match request
    const matchRequest = await Match.findById(matchId);
    if (!matchRequest) {
      return res.status(404).json({ message: 'Match request not found' });
    }

    const receiverTeamId = matchRequest.createdBy;

    // Validation 1: Check if match is still open
    if (matchRequest.status !== 'open') {
      return res.status(400).json({
        message: 'This match request is no longer open for invites'
      });
    }

    // Validation 2: Prevent self-invites
    if (senderTeamId.toString() === receiverTeamId.toString()) {
      return res.status(400).json({
        message: 'You cannot send an invite to your own match request'
      });
    }

    // Validation 3: Check for existing invite
    const existingInvite = await MatchInvite.findOne({
      senderTeam: senderTeamId,
      matchRequest: matchId
    });

    if (existingInvite) {
      return res.status(400).json({
        message: 'You have already sent an invite for this match'
      });
    }

    // Create new match invite
    const newInvite = new MatchInvite({
      senderTeam: senderTeamId,
      receiverTeam: receiverTeamId,
      matchRequest: matchId,
      status: 'pending',
      sentAt: new Date()
    });

    const savedInvite = await newInvite.save();

    // Fetch receiver team details for email
    const receiverTeam = await Team.findById(receiverTeamId);
    if (!receiverTeam) {
      return res.status(404).json({ message: 'Receiver team not found' });
    }

    // Populate team details for response
    const populatedInvite = await MatchInvite.findById(savedInvite._id)
      .populate('senderTeam', 'teamName collegeName')
      .populate('receiverTeam', 'teamName collegeName')
      .populate('matchRequest', 'matchTime location');

    // Create notification for the receiver
    const notification = new Notification({
      teamId: receiverTeamId,
      message: `New match invite from ${req.user.teamName}`,
      type: 'invite',
      relatedMatch: matchId,
      relatedInvite: savedInvite._id
    });

    await notification.save();

    // Send email notification
    await sendMatchInviteEmail(
      receiverTeam.email,
      {
        matchTime: matchRequest.matchTime,
        location: matchRequest.location
      },
      {
        teamName: req.user.teamName,
        collegeName: req.user.collegeName
      }
    );

    res.status(201).json(populatedInvite);

  } catch (error) {
    console.error('Error creating match invite:', error);
    if (error.code === 11000) { // Duplicate key error
      return res.status(400).json({
        message: 'You have already sent an invite for this match'
      });
    }
    res.status(500).json({ message: 'Error creating match invite' });
  }
});

// Get all invites for a specific match
router.get('/match/:matchId', authenticate, async (req, res) => {
  try {
    const { matchId } = req.params;
    const teamId = req.user._id;

    // Validate matchId format
    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Invalid match ID format' });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    // Only allow the match creator to view invites
    if (match.createdBy.toString() !== teamId.toString()) {
      return res.status(403).json({
        message: 'You can only view invites for matches you created'
      });
    }

    const invites = await MatchInvite.find({ matchRequest: matchId })
      .populate('senderTeam', 'teamName collegeName')
      .populate('matchRequest', 'matchTime location status')
      .sort({ sentAt: -1 }); // Most recent first

    // Format the response
    const formattedInvites = invites.map(invite => ({
      _id: invite._id,
      status: invite.status,
      senderTeam: {
        teamName: invite.senderTeam.teamName,
        collegeName: invite.senderTeam.collegeName
      },
      matchDetails: {
        matchTime: invite.matchRequest.matchTime,
        location: invite.matchRequest.location,
        status: invite.matchRequest.status
      },
      sentAt: invite.sentAt,
      respondedAt: invite.respondedAt
    }));

    res.json({
      match: {
        _id: match._id,
        matchTime: match.matchTime,
        location: match.location,
        status: match.status
      },
      invites: formattedInvites
    });

  } catch (error) {
    console.error('Error fetching match invites:', error);
    res.status(500).json({ message: 'Error fetching match invites' });
  }
});

// Get all invites sent by the authenticated team
router.get('/sent', authenticate, async (req, res) => {
  try {
    const teamId = req.user._id;

    const invites = await MatchInvite.find({ senderTeam: teamId })
      .populate('receiverTeam', 'teamName collegeName')
      .populate('matchRequest', 'matchTime location status')
      .sort({ sentAt: -1 }); // Sort by most recent first

    // Transform the response to match the required format
    const formattedInvites = invites.map(invite => ({
      _id: invite._id,
      status: invite.status,
      receiverTeam: {
        teamName: invite.receiverTeam.teamName,
        collegeName: invite.receiverTeam.collegeName
      },
      matchRequest: {
        matchTime: invite.matchRequest.matchTime,
        location: invite.matchRequest.location,
        status: invite.matchRequest.status
      },
      sentAt: invite.sentAt
    }));

    res.json(formattedInvites);

  } catch (error) {
    console.error('Error fetching sent invites:', error);
    res.status(500).json({ message: 'Error fetching sent invites' });
  }
});

// Get all invites received by the authenticated team
router.get('/received', authenticate, async (req, res) => {
  try {
    const teamId = req.user._id;

    const invites = await MatchInvite.find({ receiverTeam: teamId })
      .populate('senderTeam', 'teamName collegeName')
      .populate('matchRequest', 'matchTime location status')
      .sort({ sentAt: -1 }); // Sort by most recent first

    // Transform the response to match the required format
    const formattedInvites = invites.map(invite => ({
      _id: invite._id,
      status: invite.status,
      senderTeam: {
        teamName: invite.senderTeam.teamName,
        collegeName: invite.senderTeam.collegeName
      },
      matchRequest: {
        matchTime: invite.matchRequest.matchTime,
        location: invite.matchRequest.location,
        status: invite.matchRequest.status
      },
      sentAt: invite.sentAt
    }));

    res.json(formattedInvites);

  } catch (error) {
    console.error('Error fetching received invites:', error);
    res.status(500).json({ message: 'Error fetching received invites' });
  }
});

// Accept a match invite
router.put('/:inviteId/accept', authenticate, async (req, res) => {
  try {
    const { inviteId } = req.params;
    const teamId = req.user._id;

    // Validate invite ID format
    if (!mongoose.Types.ObjectId.isValid(inviteId)) {
      return res.status(400).json({ message: 'Invalid invite ID format' });
    }

    // Find the invite with populated match details
    const invite = await MatchInvite.findById(inviteId)
      .populate('senderTeam', 'teamName collegeName')
      .populate('receiverTeam', 'teamName collegeName')
      .populate('matchRequest', 'matchTime location status');

    if (!invite) {
      return res.status(404).json({ message: 'Invite not found' });
    }

    // Check if the invite is still pending
    if (invite.status !== 'pending') {
      return res.status(400).json({ message: 'Invite is no longer pending' });
    }

    // Check if the current team is the receiver of the invite
    if (invite.receiverTeam._id.toString() !== teamId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to accept this invite' });
    }

    // Check if the match is still open
    if (invite.matchRequest.status !== 'open') {
      return res.status(400).json({ message: 'Match is no longer open for invites' });
    }

    // Update the invite status to accepted
    invite.status = 'accepted';
    invite.respondedAt = new Date();
    await invite.save();

    // Update the match request status
    await Match.findByIdAndUpdate(
      invite.matchRequest._id,
      { 
        status: 'accepted',
        $push: { acceptedTeams: teamId }
      }
    );

    // Create notification for the sender
    const notification = new Notification({
      teamId: invite.senderTeam._id,
      message: `Your match invite has been accepted by ${req.user.name}`,
      type: 'match_update',
      relatedMatch: invite.matchRequest._id
    });

    await notification.save();

    // Send email notification
    await sendMatchAcceptanceEmail(
      invite.senderTeam.email,
      {
        matchTime: invite.matchRequest.matchTime,
        location: invite.matchRequest.location
      },
      {
        teamName: req.user.name,
        collegeName: req.user.collegeName
      }
    );

    // Reject all other pending invites for this match
    await MatchInvite.updateMany(
      {
        matchRequest: invite.matchRequest._id,
        _id: { $ne: inviteId },
        status: 'pending'
      },
      {
        status: 'rejected',
        respondedAt: new Date()
      }
    );

    // Create notifications for rejected invites
    const rejectedInvites = await MatchInvite.find({
      matchRequest: invite.matchRequest._id,
      _id: { $ne: inviteId },
      status: 'rejected'
    });

    for (const rejectedInvite of rejectedInvites) {
      const notification = new Notification({
        teamId: rejectedInvite.senderTeam,
        message: `Your match invite has been rejected as another team accepted the match`,
        type: 'match_update',
        relatedMatch: invite.matchRequest._id
      });
      await notification.save();
    }

    // Get the updated invite with all populated fields
    const updatedInvite = await MatchInvite.findById(inviteId)
      .populate('senderTeam', 'teamName collegeName')
      .populate('receiverTeam', 'teamName collegeName')
      .populate('matchRequest', 'matchTime location status');

    res.json({
      message: 'Match invite accepted successfully',
      invite: {
        _id: updatedInvite._id,
        status: updatedInvite.status,
        senderTeam: {
          teamName: updatedInvite.senderTeam.teamName,
          collegeName: updatedInvite.senderTeam.collegeName
        },
        receiverTeam: {
          teamName: updatedInvite.receiverTeam.teamName,
          collegeName: updatedInvite.receiverTeam.collegeName
        },
        matchDetails: {
          matchTime: updatedInvite.matchRequest.matchTime,
          location: updatedInvite.matchRequest.location,
          status: updatedInvite.matchRequest.status
        },
        sentAt: updatedInvite.sentAt,
        respondedAt: updatedInvite.respondedAt
      }
    });
  } catch (error) {
    console.error('Error accepting match invite:', error);
    res.status(500).json({ message: 'Error accepting match invite', error: error.message });
  }
});

module.exports = router; 