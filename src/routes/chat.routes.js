const express = require('express');
const router = express.Router();
const Chat = require('../models/chat.model');
const { authenticateToken } = require('../middleware/auth.middleware');

// Get chat history for a match
router.get('/matches/:matchId', authenticateToken, async (req, res) => {
  try {
    const messages = await Chat.find({ matchId: req.params.matchId })
      .sort({ timestamp: 1 })
      .populate('senderTeam', 'teamName collegeName');

    res.json(messages);
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    res.status(500).json({ message: 'Error fetching chat messages' });
  }
});

// Send a message in a match chat
router.post('/matches/:matchId', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    const message = new Chat({
      matchId: req.params.matchId,
      senderTeam: req.team._id,
      content
    });

    await message.save();

    // Populate sender team details
    await message.populate('senderTeam', 'teamName collegeName');

    res.status(201).json(message);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ message: 'Error sending message' });
  }
});

module.exports = router; 