const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin'); // ✅ Import your Admin model
// const { authorizeAdmin } = require('../middleware/authorizeAdmin.middleware');

// // All routes below require admin authorization
// router.use(authorizeAdmin);

// ✅ Create a new admin
router.post('/', async (req, res) => {
  try {
    const adminExists = await Admin.exists({});
    if (adminExists) {
      return res.status(400).json({ error: 'An admin already exists. Only one admin is allowed.' });
    }

    const { username, password, email } = req.body;
    // TODO: Hash password before saving in production
    const admin = new Admin({ username, password, email });
    await admin.save();
    res.status(201).json(admin);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ✅ Get all admins
router.get('/', async (req, res) => {
  try {
    const admins = await Admin.find(); // 🔁 get all
    res.json(admins);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get a specific admin by ID
router.get('/:id', async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ message: 'Admin not found' });
    res.json(admin);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Update an admin by ID
router.put('/:id', async (req, res) => {
  try {
    const updatedAdmin = await Admin.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedAdmin) return res.status(404).json({ message: 'Admin not found' });
    res.json(updatedAdmin);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ✅ Delete an admin by ID
router.delete('/:id', async (req, res) => {
  try {
    const deletedAdmin = await Admin.findByIdAndDelete(req.params.id);
    if (!deletedAdmin) return res.status(404).json({ message: 'Admin not found' });
    res.json({ message: 'Admin deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
