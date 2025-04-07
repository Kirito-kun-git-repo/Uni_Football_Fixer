const express = require('express');
const router = express.Router();
const Notification = require('../models/notification.model');
const { authenticateToken } = require('../middleware/auth.middleware');

// Get all notifications for authenticated team
router.get('/', authenticateToken, async (req, res) => {
  try {
    const notifications = await Notification.find({ teamId: req.team._id })
      .sort({ createdAt: -1 })
      .populate('relatedMatch', 'matchTime location')
      .populate('relatedInvite', 'status');

    res.json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Error fetching notifications' });
  }
});

// Mark notification as read
router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      teamId: req.team._id
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    notification.read = true;
    await notification.save();

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ message: 'Error marking notification as read' });
  }
});

// Mark all notifications as read
router.patch('/read-all', authenticateToken, async (req, res) => {
  try {
    await Notification.updateMany(
      { teamId: req.team._id, read: false },
      { read: true }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ message: 'Error marking all notifications as read' });
  }
});

module.exports = router; 