const express = require('express');
const Admin = require('../models/admin.model');
const router = express.Router();
const adminController = require('../controllers/admin.controller');

// Create a new admin
router.post('/', adminController.createAdmin);

// Get all admins
router.get('/', adminController.getAllAdmins);

// Get a specific admin by ID
router.get('/:id', adminController.getAdminById);

// ✅ Update an admin by ID
router.put('/:id', adminController.updateAdmin);

// Delete an admin by ID
router.delete('/:id', adminController.deleteAdmin);

module.exports = router;
