// invite.controller.js
// Controller functions for match invite routes

const mongoose = require('mongoose');
const Match = require('../models/match.model');
const MatchInvite = require('../models/matchInvite.model');
const Notification = require('../models/notification.model');
const { sendMatchInviteEmail, sendMatchAcceptanceEmail, sendMatchSettledEmail } = require('../utils/email');
const Team = require('../models/team.model');

/**
 * Create a new match invite
 */
exports.createInvite = async (req, res) => {
  try {
    const { matchId } = req.params;
    const senderTeamId = req.team._id;
    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Invalid match ID format' });
    }
    const matchRequest = await Match.findById(matchId);
    if (!matchRequest) {
      return res.status(404).json({ message: 'Match request not found' });
    }
    const receiverTeamId = matchRequest.createdBy;
    if (matchRequest.status !== 'open') {
      return res.status(400).json({ message: 'This match request is no longer open for invites' });
    }
    if (senderTeamId.toString() === receiverTeamId.toString()) {
      return res
        .status(400)
        .json({ message: 'You cannot send an invite to your own match request' });
    }
    const existingInvite = await MatchInvite.findOne({
      senderTeam: senderTeamId,
      matchRequest: matchId,
    });
    if (existingInvite) {
      return res.status(400).json({ message: 'You have already sent an invite for this match' });
    }
    const newInvite = new MatchInvite({
      senderTeam: senderTeamId,
      receiverTeam: receiverTeamId,
      matchRequest: matchId,
      status: 'pending',
      sentAt: new Date(),
    });
    const savedInvite = await newInvite.save();
    const receiverTeam = await Team.findById(receiverTeamId);
    if (!receiverTeam) {
      return res.status(404).json({ message: 'Receiver team not found' });
    }
    const populatedInvite = await MatchInvite.findById(savedInvite._id)
      .populate('senderTeam', 'teamName collegeName')
      .populate('receiverTeam', 'teamName collegeName')
      .populate('matchRequest');

    // Create notification for receiver team
    await Notification.create({
      teamId: receiverTeamId,
      message: `You have received a match invite from ${req.team.teamName}`,
      type: 'invite',
      relatedMatch: matchId,
      relatedInvite: savedInvite._id,
      read: false,
      createdAt: new Date(),
    });

    // Send email notification (optional, handle errors inside util)
    sendMatchInviteEmail(receiverTeam.email, populatedInvite.matchRequest, populatedInvite.senderTeam);
    res.status(201).json(populatedInvite);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create invite', error: err.message });
  }
};

/**
 * Get all invites for a specific match
 */
exports.getInvitesForMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const teamId = req.team._id;
    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Invalid match ID format' });
    }
    const invites = await MatchInvite.find({
      matchRequest: matchId,
      $or: [{ senderTeam: teamId }, { receiverTeam: teamId }],
    })
      .populate('senderTeam', 'teamName collegeName')
      .populate('receiverTeam', 'teamName collegeName')
      .populate('matchRequest');
    res.status(200).json(invites);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch invites', error: err.message });
  }
};

/**
 * Accept a match invite
 */
exports.acceptInvite = async (req, res) => {
  try {
    const { inviteId } = req.params;
    const teamId = req.team._id;
    if (!mongoose.Types.ObjectId.isValid(inviteId)) {
      return res.status(400).json({ message: 'Invalid invite ID format' });
    }
    const invite = await MatchInvite.findById(inviteId);
    if (!invite) {
      return res.status(404).json({ message: 'Invite not found' });
    }
    if (invite.receiverTeam.toString() !== teamId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to accept this invite' });
    }
    if (invite.status !== 'pending') {
      return res.status(400).json({ message: 'Invite is no longer pending' });
    }
    invite.status = 'accepted';
    invite.respondedAt = new Date();
    await invite.save();
    // Update match status
    await Match.findByIdAndUpdate(invite.matchRequest, { status: 'accepted' });
    // Notify both teams that the match has been settled
    const senderTeam = await Team.findById(invite.senderTeam);
    const receiverTeam = await Team.findById(invite.receiverTeam);
    const matchDetails = await Match.findById(invite.matchRequest);
    if (senderTeam && receiverTeam && matchDetails) {
      // Send to both teams
      sendMatchSettledEmail(senderTeam.email, matchDetails, senderTeam, receiverTeam);
      sendMatchSettledEmail(receiverTeam.email, matchDetails, senderTeam, receiverTeam);

      // Create notification for sender team (invite creator)
      await Notification.create({
        teamId: senderTeam._id,
        message: `${receiverTeam.teamName} accepted your match invite!`,
        type: 'invite-accepted',
        relatedMatch: invite.matchRequest,
        relatedInvite: invite._id,
        read: false,
        createdAt: new Date(),
      });
    }
    res.status(200).json({ message: 'Invite accepted', invite });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to accept invite', error: err.message });
  }
};

/**
 * Get all invites for a specific match (for match creator)
 */
exports.getInvitesForMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const teamId = req.team._id;
    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Invalid match ID format' });
    }
    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }
    if (match.createdBy.toString() !== teamId.toString()) {
      return res.status(403).json({ message: 'You can only view invites for matches you created' });
    }
    const invites = await MatchInvite.find({ matchRequest: matchId })
      .populate('senderTeam', 'teamName collegeName')
      .populate('matchRequest', 'matchTime location status')
      .sort({ sentAt: -1 });
    const formattedInvites = invites.map((invite) => ({
      _id: invite._id,
      status: invite.status,
      senderTeam: {
        teamName: invite.senderTeam.teamName,
        collegeName: invite.senderTeam.collegeName,
      },
      matchDetails: {
        matchTime: invite.matchRequest.matchTime,
        location: invite.matchRequest.location,
        status: invite.matchRequest.status,
      },
      sentAt: invite.sentAt,
      respondedAt: invite.respondedAt,
    }));
    res.json({
      match: {
        _id: match._id,
        matchTime: match.matchTime,
        location: match.location,
        status: match.status,
      },
      invites: formattedInvites,
    });
  } catch (error) {
    console.error('Error fetching match invites:', error);
    res.status(500).json({ message: 'Error fetching match invites' });
  }
};

/**
 * Get all invites sent by the authenticated team
 */
exports.getSentInvites = async (req, res) => {
  try {
    const teamId = req.team._id;
    const invites = await MatchInvite.find({ senderTeam: teamId })
      .populate('receiverTeam', 'teamName collegeName')
      .populate('matchRequest', 'matchTime location status')
      .sort({ sentAt: -1 });
    const formattedInvites = invites.map((invite) => ({
      _id: invite._id,
      status: invite.status,
      receiverTeam: {
        teamName: invite.receiverTeam.teamName,
        collegeName: invite.receiverTeam.collegeName,
      },
      matchRequest: {
        matchTime: invite.matchRequest.matchTime,
        location: invite.matchRequest.location,
        status: invite.matchRequest.status,
      },
      sentAt: invite.sentAt,
    }));
    res.json(formattedInvites);
  } catch (error) {
    console.error('Error fetching sent invites:', error);
    res.status(500).json({ message: 'Error fetching sent invites' });
  }
};

/**
 * Get all invites received by the authenticated team
 */
exports.getReceivedInvites = async (req, res) => {
  try {
    const teamId = req.team._id;
    const invites = await MatchInvite.find({ receiverTeam: teamId })
      .populate('senderTeam', 'teamName collegeName')
      .populate('matchRequest', 'matchTime location status')
      .sort({ sentAt: -1 });
    const formattedInvites = invites.map((invite) => ({
      _id: invite._id,
      status: invite.status,
      senderTeam: {
        teamName: invite.senderTeam.teamName,
        collegeName: invite.senderTeam.collegeName,
      },
      matchRequest: {
        matchTime: invite.matchRequest.matchTime,
        location: invite.matchRequest.location,
        status: invite.matchRequest.status,
      },
      sentAt: invite.sentAt,
    }));
    res.json(formattedInvites);
  } catch (error) {
    console.error('Error fetching received invites:', error);
    res.status(500).json({ message: 'Error fetching received invites' });
  }
};
