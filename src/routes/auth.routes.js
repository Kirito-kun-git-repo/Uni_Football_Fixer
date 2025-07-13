const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Team = require('../models/team.model');

// Multer configuration (memory storage)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Team Registration
const authController = require('../controllers/auth.controller');

router.post('/register', upload.single('profilePicture'), authController.registerTeam);

// Team Login
router.post('/login', authController.loginTeam);

module.exports = router;
