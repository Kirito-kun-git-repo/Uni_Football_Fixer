const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth.middleware');
const teamController = require('../controllers/team.controller');

// Multer configuration (memory storage)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});


// Get all teams
router.get('/', teamController.getAllTeams);

// Get team profile
router.get('/profile', authenticateToken, teamController.getTeamProfile);

// Update team profile
router.put(
  '/profile',
  authenticateToken,
  upload.single('profilePicture'),
  teamController.updateTeamProfile
);

// Change password
router.put('/change-password', authenticateToken, teamController.changePassword);

module.exports = router;
