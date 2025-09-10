const mongoose = require('mongoose');

const matchInviteSchema = new mongoose.Schema({
  senderTeamId: {
    type: String, // teamId from Identity Service
    required: true,
  },
  receiverTeamId: {
    type: String, // teamId from Identity Service (match creator)
    required: true,
  },
  matchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Match', // still valid, Match is in this service
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'expired'],
    default: 'pending',
  },
  sentAt: {
    type: Date,
    default: Date.now,
  },
  respondedAt: {
    type: Date,
  },
});

// Prevent duplicate invites (one sender -> one match)
matchInviteSchema.index({ senderTeamId: 1, matchId: 1 }, { unique: true });

module.exports = mongoose.model('MatchInvite', matchInviteSchema);
