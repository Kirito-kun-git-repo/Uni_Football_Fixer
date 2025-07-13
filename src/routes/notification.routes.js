const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

router.get('/', authenticateToken, notificationController.getNotifications);

// Mark notification as read
router.patch('/:id/read', authenticateToken, notificationController.markAsRead);

// Mark all notifications as read
router.patch('/read-all', authenticateToken, notificationController.markAllAsRead);

module.exports = router;
