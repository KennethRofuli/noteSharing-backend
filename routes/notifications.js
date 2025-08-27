const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');
const mongoose = require('mongoose'); // Add this for ObjectId

// Test route to check if notifications routes are working
router.get('/ping', (req, res) => {
  res.json({ message: 'Notification routes are working' });
});

// Get all notifications for current user - FIXED VERSION
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    
    console.log('Fetching notifications for user:', userId);
    
    // Create a safer query with better error handling
    const notifications = await Notification.find({
      recipient: userId
    })
    .sort({ createdAt: -1 })
    .populate('sender', 'name email')
    .limit(30)
    .lean(); // Use lean() for better performance
    
    console.log(`Found ${notifications.length} notifications`);
    return res.json(notifications || []);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    return res.status(500).json({ 
      message: 'Error fetching notifications',
      error: err.message
    });
  }
});

// Get unread count
router.get('/unread-count', auth, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ 
      recipient: req.user._id,
      read: false
    });
    
    res.json({ count });
  } catch (err) {
    console.error('Error counting unread notifications:', err);
    res.status(500).json({ message: 'Error counting notifications' });
  }
});

// Mark notification as read
router.put('/:id/read', auth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { read: true },
      { new: true }
    );
    
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    
    res.json(notification);
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ message: 'Error updating notification' });
  }
});

// Mark all notifications as read
router.put('/read-all', auth, async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, read: false },
      { $set: { read: true } }
    );
    
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error('Error marking all notifications as read:', err);
    res.status(500).json({ message: 'Error updating notifications' });
  }
});

// Add this test endpoint
router.post('/create-test', auth, async (req, res) => {
  try {
    console.log('Creating test notification for user:', req.user._id);
    
    const newNotification = new Notification({
      recipient: req.user._id,
      type: 'note_shared',
      sender: req.user._id,
      reference: req.user._id, // Using user ID as a placeholder
      referenceModel: 'Note',
      content: 'This is a test notification'
    });
    
    await newNotification.save();
    console.log('Test notification created:', newNotification);
    
    res.json({ 
      message: 'Test notification created',
      notification: newNotification
    });
  } catch (err) {
    console.error('Error creating test notification:', err);
    res.status(500).json({ message: 'Error creating test notification' });
  }
});

module.exports = router;