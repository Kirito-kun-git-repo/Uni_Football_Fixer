const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Team = require('../models/team.model');

// Team Registration
exports.registerTeam = async (req, res) => {
  try {
    const { teamName, collegeName, email, password } = req.body;
    let profilePictureBase64 = null;

    // Validate required fields
    if (!teamName || !collegeName || !email || !password) {
      return res.status(400).json({
        message: 'All fields are required: teamName, collegeName, email, password',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        message: 'Please provide a valid email address',
      });
    }

    // Handle image buffer, convert to base64
    if (req.file) {
      profilePictureBase64 = req.file.buffer.toString('base64');
    }

    // Check if team name or email already exists
    const existingTeam = await Team.findOne({ $or: [{ teamName }, { email }] });
    if (existingTeam) {
      return res.status(400).json({
        message:
          existingTeam.teamName === teamName
            ? 'Team name already exists'
            : 'Email already registered',
      });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new team
    const newTeam = new Team({
      teamName,
      collegeName,
      email,
      password: hashedPassword,
      profilePicture: profilePictureBase64,
    });

    // Save the team
    const savedTeam = await newTeam.save();

    // Create JWT token
    const token = jwt.sign({ id: savedTeam._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Return success response without password
    res.status(201).json({
      message: 'Team registered successfully',
      team: {
        _id: savedTeam._id,
        teamName: savedTeam.teamName,
        collegeName: savedTeam.collegeName,
        email: savedTeam.email,
        profilePicture: savedTeam.profilePicture,
      },
      token,
    });
  } catch (error) {
    console.error('Error in team registration:', error);
    res.status(500).json({
      message: 'Error registering team',
    });
  }
};

// Team Login
exports.loginTeam = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password are required',
      });
    }

    // Find team by email
    const team = await Team.findOne({ email });
    if (!team) {
      return res.status(401).json({
        message: 'Invalid email or password',
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, team.password);
    if (!isValidPassword) {
      return res.status(401).json({
        message: 'Invalid email or password',
      });
    }

    // Create JWT token
    const token = jwt.sign({ id: team._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Return success response
    res.json({
      message: 'Login successful',
      team: {
        _id: team._id,
        teamName: team.teamName,
        collegeName: team.collegeName,
        email: team.email,
        profilePicture: team.profilePicture,
      },
      token,
    });
  } catch (error) {
    console.error('Error in team login:', error);
    res.status(500).json({
      message: 'Error logging in',
    });
  }
};
