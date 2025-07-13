const Match = require('../models/match.model');

// Get all matches (Public Display Board - No authentication required)
exports.getAllMatches = async (req, res) => {
  try {
    const matches = await Match.find({ status: 'open' })
      .populate('createdBy', 'teamName collegeName')
      .sort({ matchTime: 1 });

    const formattedMatches = matches.map((match) => ({
      _id: match._id,
      matchTime: match.matchTime,
      location: match.location,
      status: match.status,
      createdBy: {
        teamName: match.createdBy.teamName,
        collegeName: match.createdBy.collegeName,
      },
      createdAt: match.createdAt,
    }));

    res.json(formattedMatches);
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ message: 'Error fetching matches' });
  }
};

// Create a new match request (Protected - Requires authentication)
exports.createMatch = async (req, res) => {
  console.log('createMatch req.body:', req.body);
  console.log('createMatch req.team:', req.team);
  console.log('typeof req.body.matchTime:', typeof req.body.matchTime, 'value:', req.body.matchTime);
  try {
    const { matchTime, location } = req.body;
    // Validate matchTime is a valid date
    if (!matchTime || isNaN(new Date(matchTime).getTime())) {
      return res.status(400).json({ message: 'Invalid matchTime: must be a valid date string.' });
    }
    const newMatch = new Match({
      createdBy: req.team._id,
      matchTime,
      location,
      status: 'open',
    });
    const savedMatch = await newMatch.save();
    const populatedMatch = await Match.findById(savedMatch._id).populate(
      'createdBy',
      'teamName collegeName'
    );
    res.status(201).json({
      _id: populatedMatch._id,
      matchTime: populatedMatch.matchTime,
      location: populatedMatch.location,
      status: populatedMatch.status,
      createdBy: {
        teamName: populatedMatch.createdBy.teamName,
        collegeName: populatedMatch.createdBy.collegeName,
      },
      createdAt: populatedMatch.createdAt,
    });
  } catch (error) {
    console.error('Error creating match:', error);
    res.status(500).json({ message: 'Error creating match request' });
  }
};

// Get matches created by the authenticated team (Protected)
exports.getMyMatches = async (req, res) => {};

// Update a match
exports.updateMatch = async (req, res) => {
  try {
    const updatedMatch = await Match.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('createdBy', 'teamName collegeName');
    if (!updatedMatch) return res.status(404).json({ message: 'Match not found' });

    res.json({
      message: 'Match updated successfully',
      match: {
        _id: updatedMatch._id,
        title: updatedMatch.title,
        location: updatedMatch.location,
        matchTime: updatedMatch.matchTime,
        description: updatedMatch.description,
        createdBy: {
          _id: updatedMatch.createdBy._id,
          teamName: updatedMatch.createdBy.teamName,
          collegeName: updatedMatch.createdBy.collegeName
        },
        createdAt: updatedMatch.createdAt,
        status: updatedMatch.status
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating match' });
  }
};

// Delete a match
exports.deleteMatch = async (req, res) => {
  try {
    const deletedMatch = await Match.findByIdAndDelete(req.params.id);
    if (!deletedMatch) return res.status(404).json({ message: 'Match not found' });
    res.json({ message: 'Match deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting match' });
  }
};

// Get a single match by ID (public)
exports.getMatchById = async (req, res) => {
  try {
    const match = await Match.findById(req.params.id).populate('createdBy', 'teamName collegeName');
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }
    res.json({
      _id: match._id,
      matchTime: match.matchTime,
      location: match.location,
      status: match.status,
      createdBy: {
        teamName: match.createdBy.teamName,
        collegeName: match.createdBy.collegeName,
      },
      createdAt: match.createdAt,
      description: match.description
    });
  } catch (error) {
    console.error('Error fetching match:', error);
    res.status(500).json({ message: 'Error fetching match' });
  }
};

// Get matches created by the authenticated team (Protected)
exports.getMyMatches = async (req, res) => {
  try {
    const matches = await Match.find({ createdBy: req.team._id }).sort({ matchTime: 1 });
    const formattedMatches = matches.map((match) => ({
      _id: match._id,
      matchTime: match.matchTime,
      location: match.location,
      status: match.status,
      createdAt: match.createdAt,
    }));
    res.json(formattedMatches);
  } catch (error) {
    console.error('Error fetching your matches:', error);
    res.status(500).json({ message: 'Error fetching your matches' });
  }
};
