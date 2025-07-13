const express = require('express');
const router = express.Router();
const matchController = require('../controllers/match.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

// Get all matches (Public Display Board - No authentication required)
router.get('/', matchController.getAllMatches);

// Create a new match request (Protected - Requires authentication)
router.post('/', authenticateToken, matchController.createMatch);

// Get matches created by the authenticated team (Protected - Requires authentication)
router.get('/my-matches', authenticateToken, matchController.getMyMatches);

// Get a single match by ID (Public)
router.get('/:id', matchController.getMatchById);

// Update a match by ID (Protected)
router.put('/:id', authenticateToken, matchController.updateMatch);
// Delete a match by ID (Protected)
router.delete('/:id', authenticateToken, matchController.deleteMatch);

module.exports = router;
