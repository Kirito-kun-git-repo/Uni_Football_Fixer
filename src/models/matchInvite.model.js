const mongoose = require('mongoose');

const matchInviteSchema = new mongoose.Schema({
  senderTeam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  receiverTeam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  matchRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Match',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'expired'],
    default: 'pending'
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  respondedAt: {
    type: Date
  }
});

// Index to prevent duplicate invites
matchInviteSchema.index({ senderTeam: 1, matchRequest: 1 }, { unique: true });

module.exports = mongoose.model('MatchInvite', matchInviteSchema); 