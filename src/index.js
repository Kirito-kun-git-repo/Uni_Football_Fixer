// index.js
// Entry point: loads environment, connects to DB, starts server, sets up Socket.IO

require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const app = require('./app');
const { initializePassport } = require('./config/passport');
const initializeSocket = require('./socket/socket');
const passport = require('passport');

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

// Connect to MongoDB and start server
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log('WebSocket server is ready at ws://localhost:' + PORT);
      console.log('Test chat page available at http://localhost:' + PORT + '/test-chat.html');
    });
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  });

// Error handling middleware (fallback)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});
