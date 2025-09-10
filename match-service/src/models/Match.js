// models/Match.js
const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  // Instead of ObjectId ref, we store the Team's UUID/ID from Identity Service
  teamId: {
    type: String, 
    required: true,
  },

  // Cached team info from Identity Service
  teamName: {
    type: String,
  },
  collegeName: {
    type: String,
  },

  matchTime: {
    type: Date,
    required: true,
  },

  location: {
    type: String,
    required: true,
  },

  status: {
    type: String,
    enum: ['open', 'matched', 'cancelled', 'completed'],
    default: 'open',
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Match', matchSchema);
