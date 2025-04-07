const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const cors = require('cors');
const http = require('http');
const { setupSocket } = require('./socket/socket');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(passport.initialize());

// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
const teamRoutes = require('./routes/team.routes');
const matchRoutes = require('./routes/match.routes');
const inviteRoutes = require('./routes/invite.routes');
const notificationRoutes = require('./routes/notification.routes');
const chatRoutes = require('./routes/chat.routes');

app.use('/api/teams', teamRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chat', chatRoutes);

// Create HTTP server
console.log('Creating HTTP server...');
const server = http.createServer(app);

// Setup Socket.IO
console.log('Setting up Socket.IO...');
const io = setupSocket(server);
console.log('Socket.IO setup complete');

// Make io accessible to routes
app.set('io', io);

// Add error handling for the server
server.on('error', (error) => {
  console.error('Server error:', error);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('WebSocket server is ready at ws://localhost:' + PORT);
}); 