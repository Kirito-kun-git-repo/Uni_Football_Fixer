// app.js
// Configures and exports the Express app (middleware, routes, etc.). Does NOT start the server or connect to the database.

const express = require('express');
const passport = require('passport');
const cors = require('cors');
// const path = require('path');

const app = express();
const path = require('path');
// Serve uploads directory for profile pictures
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Import and use routes
const teamRoutes = require('./routes/team.routes');
const matchRoutes = require('./routes/match.routes');
const inviteRoutes = require('./routes/invite.routes');
const notificationRoutes = require('./routes/notification.routes');
const chatRoutes = require('./routes/chat.routes');
const adminRoutes = require('./routes/admin.routes');
const authRoutes = require('./routes/auth.routes');

app.use('/api/auth', authRoutes);
app.use('/api/teams', teamRoutes); // Only profile, update, and change-password endpoints remain. Registration and login are now only under /api/auth.
app.use('/api/matches', matchRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/auth', require('./routes/admin.auth.routes'));


// Export the configured app
module.exports = app;
