const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Team = require('../models/team.model');
const { authenticateToken } = require('../middleware/auth.middleware');

// Multer configuration (memory storage)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// // Register a new team
// router.post('/register', upload.single('profilePicture'), async (req, res) => {
//   try {
//     const { teamName, collegeName, password, email } = req.body;
//     let profilePictureBase64 = null;

//     // Handle image buffer, convert to base64
//     if (req.file) {
//       profilePictureBase64 = req.file.buffer.toString('base64');
//     }

//     // Check if team already exists
//     const existingTeam = await Team.findOne({ $or: [{ teamName }, { email }] });
//     if (existingTeam) {
//       return res.status(400).json({ 
//         message: existingTeam.teamName === teamName ? 'Team name already exists' : 'Email already registered'
//       });
//     }

//     // Hash password
//     const salt = await bcrypt.genSalt(10);
//     const hashedPassword = await bcrypt.hash(password, salt);

//     // Create new team
//     const team = new Team({
//       teamName,
//       collegeName,
//       email,
//       password: hashedPassword,
//       profilePicture: profilePictureBase64
//     });

//     await team.save();

//     // Generate JWT token
//     const token = jwt.sign(
//       { id: team._id },
//       process.env.JWT_SECRET,
//       { expiresIn: process.env.JWT_EXPIRES_IN }
//     );

//     res.status(201).json({
//       message: 'Team registered successfully',
//       token,
//       team: {
//         _id: team._id,
//         teamName: team.teamName,
//         collegeName: team.collegeName,
//         email: team.email,
//         profilePicture: team.profilePicture
//       }
//     });
//   } catch (error) {
//     console.error('Error registering team:', error);
//     res.status(500).json({ message: 'Error registering team' });
//   }
// });

// // Login team
// router.post('/login', async (req, res) => {
//   try {
//     const { teamName, password } = req.body;

//     // Find team
//     const team = await Team.findOne({ teamName });
//     if (!team) {
//       return res.status(401).json({ message: 'Invalid credentials' });
//     }

//     // Check password
//     const isMatch = await bcrypt.compare(password, team.password);
//     if (!isMatch) {
//       return res.status(401).json({ message: 'Invalid credentials' });
//     }

//     // Generate JWT token
//     const token = jwt.sign(
//       { id: team._id },
//       process.env.JWT_SECRET,
//       { expiresIn: process.env.JWT_EXPIRES_IN }
//     );

//     res.json({
//       message: 'Login successful',
//       token,
//       team: {
//         _id: team._id,
//         teamName: team.teamName,
//         collegeName: team.collegeName,
//         profilePicture: team.profilePicture
//       }
//     });
//   } catch (error) {
//     console.error('Error logging in:', error);
//     res.status(500).json({ message: 'Error logging in' });
//   }
// });

// // Get team profile
// router.get('/profile', authenticateToken, async (req, res) => {
//   try {
//     const team = await Team.findById(req.team._id)
//       .select('-password');

//     res.json(team);
//   } catch (error) {
//     console.error('Error fetching team profile:', error);
//     res.status(500).json({ message: 'Error fetching team profile' });
//   }
// });

// Update team profile
router.put('/profile', authenticateToken, upload.single('profilePicture'), async (req, res) => {
  try {
    const { teamName, collegeName } = req.body;
    let profilePictureBase64;

    if (req.file) {
      profilePictureBase64 = req.file.buffer.toString('base64');
    }

    // Check if new team name is already taken
    if (teamName && teamName !== req.team.teamName) {
      const existingTeam = await Team.findOne({ teamName });
      if (existingTeam) {
        return res.status(400).json({ message: 'Team name already exists' });
      }
    }

    // Prepare update object and only set fields if provided
    const updateObj = {};
    if (teamName) updateObj.teamName = teamName;
    if (collegeName) updateObj.collegeName = collegeName;
    if (profilePictureBase64) updateObj.profilePicture = profilePictureBase64;

    const team = await Team.findByIdAndUpdate(
      req.team._id,
      updateObj,
      { new: true }
    ).select('-password');

    res.json({
      message: 'Profile updated successfully',
      team
    });
  } catch (error) {
    console.error('Error updating team profile:', error);
    res.status(500).json({ message: 'Error updating team profile' });
  }
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Find team
    const team = await Team.findById(req.team._id);

    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, team.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    team.password = hashedPassword;
    await team.save();

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Error changing password' });
  }
});

module.exports = router; 
