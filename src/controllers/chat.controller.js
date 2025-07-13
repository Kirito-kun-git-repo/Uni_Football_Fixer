const Chat = require('../models/chat.model');
const Team = require('../models/team.model');

// Get chat history for a match
exports.getChatHistory = async (req, res) => {
  try {
    const messages = await Chat.find({ matchId: req.params.matchId })
      .sort({ timestamp: 1 })
      .populate('senderTeam', 'teamName collegeName');

    res.json(messages);
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    res.status(500).json({ message: 'Error fetching chat messages' });
  }
};

// Send a message in a match chat
exports.sendMessage = async (req, res) => {
  try {
    const { content, senderTeam } = req.body;
    const matchId = req.params.matchId;

    if (!content) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    if (!senderTeam) {
      return res.status(400).json({ message: 'Sender team ID is required' });
    }

    // Create and save the message
    const message = new Chat({
      matchId,
      senderTeam,
      content,
    });

    await message.save();

    // Populate sender team details
    await message.populate('senderTeam', 'teamName collegeName');

    // Get the Socket.IO instance
    const io = req.app.get('io');

    // Emit the new message to all clients in the match room
    io.to(matchId).emit('new-message', {
      _id: message._id,
      matchId: message.matchId,
      senderTeam: message.senderTeam,
      content: message.content,
      timestamp: message.timestamp,
    });

    res.status(201).json(message);
  } catch (error) {
    console.error('Error sending chat message:', error);
    res.status(500).json({ message: 'Error sending chat message' });
  }
};
