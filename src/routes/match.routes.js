const express = require('express');
const router = express.Router();
const passport = require('passport');
const Match = require('../models/match.model');

// Middleware to authenticate JWT token
const authenticate = passport.authenticate('jwt', { session: false });

// Get all matches (Public Display Board - No authentication required)
router.get('/', async (req, res) => {
  try {
    // Only fetch matches that are still 'open'
    const matches = await Match.find({ status: 'open' })
      .populate('createdBy', 'teamName collegeName')
      .sort({ matchTime: 1 }); // Sort by match time ascending

    // Format the response
    const formattedMatches = matches.map(match => ({
      _id: match._id,
      matchTime: match.matchTime,
      location: match.location,
      status: match.status,
      createdBy: {
        teamName: match.createdBy.teamName,
        collegeName: match.createdBy.collegeName
      },
      createdAt: match.createdAt
    }));

    res.json(formattedMatches);
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ message: 'Error fetching matches' });
  }
});

// Create a new match request (Protected - Requires authentication)
router.post('/', authenticate, async (req, res) => {
  try {
    const { matchTime, location } = req.body;
    
    const newMatch = new Match({
      createdBy: req.user._id, // team ID from JWT token
      matchTime,
      location,
      status: 'open'
    });

    const savedMatch = await newMatch.save();

    // Populate team details in response
    const populatedMatch = await Match.findById(savedMatch._id)
      .populate('createdBy', 'teamName collegeName');

    res.status(201).json({
      _id: populatedMatch._id,
      matchTime: populatedMatch.matchTime,
      location: populatedMatch.location,
      status: populatedMatch.status,
      createdBy: {
        teamName: populatedMatch.createdBy.teamName,
        collegeName: populatedMatch.createdBy.collegeName
      },
      createdAt: populatedMatch.createdAt
    });
  } catch (error) {
    console.error('Error creating match:', error);
    res.status(500).json({ message: 'Error creating match request' });
  }
});

// Get matches created by the authenticated team (Protected - Requires authentication)
router.get('/my-matches', authenticate, async (req, res) => {
  try {
    // Fetch all matches created by the team, regardless of status
    const matches = await Match.find({ createdBy: req.user._id })
      .sort({ matchTime: 1 }); // Sort by match time ascending

    // Format the response
    const formattedMatches = matches.map(match => ({
      _id: match._id,
      matchTime: match.matchTime,
      location: match.location,
      status: match.status,
      createdAt: match.createdAt
    }));

    res.json(formattedMatches);
  } catch (error) {
    console.error('Error fetching your matches:', error);
    res.status(500).json({ message: 'Error fetching your matches' });
  }
});

module.exports = router; 