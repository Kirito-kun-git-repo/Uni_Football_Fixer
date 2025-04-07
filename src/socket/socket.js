const socketIO = require('socket.io');
const Chat = require('../models/chat.model');
const Team = require('../models/team.model');

function initializeSocket(server) {
    console.log('Initializing Socket.IO server...');
    
    const io = socketIO(server, {
        cors: {
            origin: "http://localhost:3000",
            methods: ["GET", "POST"],
            credentials: true
        },
        transports: ['websocket']
    });

    // Store connected users and their typing status
    const connectedUsers = new Map();
    const typingUsers = new Map();

    io.on('connection', (socket) => {
        console.log('New client connected:', {
            socketId: socket.id,
            handshake: socket.handshake
        });

        // Welcome message
        socket.emit('welcome', { message: 'Welcome to the chat server!' });

        // Handle joining a match room
        socket.on('join-match', async (matchId) => {
            console.log('Joining match room:', {
                socketId: socket.id,
                matchId: matchId,
                currentRooms: Array.from(socket.rooms)
            });

            // Leave any existing match rooms
            socket.rooms.forEach(room => {
                if (room !== socket.id) {
                    socket.leave(room);
                }
            });

            // Join the new match room
            socket.join(matchId);
            socket.emit('joined-room', { matchId });

            // Fetch and send chat history
            try {
                const messages = await Chat.find({ matchId })
                    .sort({ timestamp: 1 })
                    .populate('senderTeam', 'teamName collegeName');
                socket.emit('chat-history', messages);
            } catch (error) {
                console.error('Error fetching chat history:', error);
            }
        });

        // Handle new messages
        socket.on('new-message', async (data) => {
            console.log('New message:', {
                socketId: socket.id,
                data: data
            });

            try {
                const { matchId, message } = data;
                const { content, senderTeam } = message;

                // Create and save the message
                const newMessage = new Chat({
                    matchId,
                    senderTeam,
                    content
                });

                await newMessage.save();

                // Populate sender team details
                await newMessage.populate('senderTeam', 'teamName collegeName');

                // Broadcast the message to all clients in the match room
                io.to(matchId).emit('new-message', {
                    _id: newMessage._id,
                    matchId: newMessage.matchId,
                    senderTeam: newMessage.senderTeam,
                    content: newMessage.content,
                    timestamp: newMessage.timestamp
                });

                // Clear typing status after sending message
                typingUsers.delete(socket.id);
                io.to(matchId).emit('typing', {
                    userId: senderTeam,
                    isTyping: false
                });
            } catch (error) {
                console.error('Error handling new message:', error);
            }
        });

        // Handle typing indicators
        socket.on('typing', async (data) => {
            const { matchId, userId, isTyping } = data;
            
            try {
                // Get team details
                const team = await Team.findById(userId);
                if (!team) {
                    console.error('Team not found for typing indicator:', userId);
                    return;
                }

                if (isTyping) {
                    typingUsers.set(socket.id, {
                        matchId,
                        userId,
                        teamName: team.teamName,
                        timestamp: Date.now()
                    });
                } else {
                    typingUsers.delete(socket.id);
                }

                // Broadcast typing status to all clients in the match room except the sender
                socket.to(matchId).emit('typing', {
                    userId,
                    teamName: team.teamName,
                    isTyping,
                    timestamp: Date.now()
                });

                console.log('Typing event:', {
                    matchId,
                    userId,
                    teamName: team.teamName,
                    isTyping
                });
            } catch (error) {
                console.error('Error handling typing indicator:', error);
            }
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
            connectedUsers.delete(socket.id);
            typingUsers.delete(socket.id);
        });
    });

    console.log('Socket.IO server initialized successfully');
    return io;
}

module.exports = initializeSocket; 