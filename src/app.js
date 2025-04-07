const notificationRoutes = require('./routes/notification.routes');
const chatRoutes = require('./routes/chat.routes');

// Routes
app.use('/api/teams', teamRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chat', chatRoutes); 