const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const auth = require('../middleware/auth');

// GET /api/chat/history/:userId
router.get('/history/:userId', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const otherId = req.params.userId;
    const messages = await Message.find({
      $or: [
        { from: userId, to: otherId },
        { from: otherId, to: userId }
      ]
    }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching messages' });
  }
});

module.exports = router;