const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const User = require('../models/User'); // Assuming you have a User model

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

// GET /api/chat/conversations - List of all conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [
            { from: userId },
            { to: userId }
          ]
        }
      },
      {
        $project: {
          from: 1,
          to: 1,
          text: 1,
          timestamp: 1,
          read: 1,
          otherUser: {
            $cond: [{ $eq: ["$from", userId] }, "$to", "$from"]
          }
        }
      },
      {
        $group: {
          _id: "$otherUser",
          lastMessage: { $last: "$text" },
          lastMessageTime: { $max: "$timestamp" },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ["$to", userId] },
                  { $eq: ["$read", false] }
                ]},
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { lastMessageTime: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userDetails"
        }
      },
      { $unwind: { path: "$userDetails", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          userId: "$_id",
          name: { $ifNull: ["$userDetails.name", "Unknown User"] },
          email: { $ifNull: ["$userDetails.email", "unknown@example.com"] },
          lastMessage: 1,
          lastMessageTime: 1,
          unreadCount: 1
        }
      }
    ]);

    res.json(conversations);
  } catch (err) {
    console.error("Error fetching conversations:", err);
    res.status(500).json({ message: "Error fetching conversations" });
  }
});


// GET /api/chat/debug - Check what messages exist
router.get('/debug', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const userIdStr = userId.toString();
    const userIdObj = new mongoose.Types.ObjectId(userIdStr);
    
    console.log('Current userId:', userIdStr);
    
    // Get all messages directly without aggregation
    const messages = await Message.find({
      $or: [
        { from: userIdStr },
        { to: userIdStr },
        { from: userIdObj },
        { to: userIdObj }
      ]
    });
    
    console.log('Found messages count:', messages.length);
    res.json({
      userId: userIdStr,
      messageCount: messages.length,
      messages: messages.map(m => ({
        id: m._id,
        from: m.from.toString(),
        to: m.to.toString(),
        text: m.text,
        timestamp: m.timestamp
      }))
    });
  } catch (err) {
    console.error('Debug error:', err);
    res.status(500).json({ message: 'Error in debug endpoint', error: err.message });
  }
});

module.exports = router;