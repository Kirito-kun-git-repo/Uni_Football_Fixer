require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const passport = require('passport');
const path = require('path');
const http = require('http');

const matchRoutes = require('./routes/match.routes');
const inviteRoutes = require('./routes/invite.routes');
const authRoutes = require('./routes/auth.routes');
const { initializePassport } = require('./config/passport');

// Import routes
const teamRoutes = require('./routes/team.routes');
const notificationRoutes = require('./routes/notification.routes');
const chatRoutes = require('./routes/chat.routes');
const adminRoutes =require('./routes/admin.routes');

// Import Socket.IO setup
const initializeSocket = require('./socket/socket');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Initialize Passport JWT strategy
initializePassport(passport);

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
console.log('Setting up Socket.IO...');
const io = initializeSocket(server);
console.log('Socket.IO setup complete');

// Make io accessible to routes
app.set('io', io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    // Start server
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log('WebSocket server is ready at ws://localhost:' + PORT);
      console.log('Test chat page available at http://localhost:' + PORT + '/test-chat.html');
    });
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
  });

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
}); 