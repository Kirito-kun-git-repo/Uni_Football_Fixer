console.log('auth.middleware.js LOADED');
const jwt = require('jsonwebtoken');
const Team = require('../models/team.model');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const team = await Team.findById(decoded.id);

    if (!team) {
      return res.status(401).json({ message: 'Team not found' });
    }

    req.team = team;
    console.log('authenticateToken: req.team =', req.team);
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    console.error('Authentication error:', error);
    res.status(500).json({ message: 'Authentication error' });
  }
};

module.exports = {
  authenticateToken,
};
