const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  teamId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Team", 
    required: true 
  },
  message: { 
    type: String, 
    required: true 
  },
  type: { 
    type: String, 
    enum: ["invite", "match_update", "chat", "system"], 
    required: true 
  },
  relatedMatch: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Match" 
  },
  relatedInvite: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Invite" 
  },
  read: { 
    type: Boolean, 
    default: false 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model('Notification', notificationSchema); 