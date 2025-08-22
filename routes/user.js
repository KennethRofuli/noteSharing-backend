// routes/user.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

// 🔹 Search users dynamically (exclude self)
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const query = req.query.q || '';
    const users = await User.find({
      email: { $regex: query, $options: 'i' },
      isVerified: true, // only verified users
      _id: { $ne: req.user.id } // exclude logged-in user
    })
      .select('email name _id') // return email + name
      .limit(10);

    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error searching users' });
  }
});

// GET /api/users/verified - list all verified users except self
router.get('/verified', authMiddleware, async (req, res) => {
  try {
    const users = await User.find({
      verified: true,
      _id: { $ne: req.user._id }
    }).select('_id email name');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching users' });
  }
});

module.exports = router;
