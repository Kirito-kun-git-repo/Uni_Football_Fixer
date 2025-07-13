const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Team = require('./models/team.model');

const setupSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: '*', // Allow all origins for development
      methods: ['GET', 'POST'],
    },
  });

  // Socket.IO authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const team = await Team.findById(decoded.id);

      if (!team) {
        return next(new Error('Authentication error: Team not found'));
      }

      socket.team = team;
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Team connected: ${socket.team.teamName}`);

    // Join match room
    socket.on('join_match', (matchId) => {
      socket.join(matchId);
      console.log(`Team ${socket.team.teamName} joined match room: ${matchId}`);
    });

    // Leave match room
    socket.on('leave_match', (matchId) => {
      socket.leave(matchId);
      console.log(`Team ${socket.team.teamName} left match room: ${matchId}`);
    });

    // Send message in match chat
    socket.on('send_message', async ({ matchId, content }) => {
      try {
        // Create chat message in database
        const Chat = require('./models/chat.model');
        const message = new Chat({
          matchId,
          senderTeam: socket.team._id,
          content,
        });
        await message.save();

        // Populate sender team details
        await message.populate('senderTeam', 'teamName collegeName');

        // Broadcast message to match room
        io.to(matchId).emit('new_message', {
          _id: message._id,
          content: message.content,
          senderTeam: {
            teamName: message.senderTeam.teamName,
            collegeName: message.senderTeam.collegeName,
          },
          timestamp: message.timestamp,
        });
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Error sending message' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`Team disconnected: ${socket.team.teamName}`);
    });
  });

  return io;
};

module.exports = setupSocket;
