// routes/note.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const mongoose = require('mongoose');

// Import models
const Note = require('../models/Note');
const User = require('../models/User');
const Notification = require('../models/Notification');

// Import controllers - only import what's used
const {
  uploadNote,
  getNotes,
  deleteNote
} = require('../controllers/noteController');

// Import middleware
const auth = require('../middleware/auth');

// File upload configuration
const allowedExtensions = [
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip"
];
const MAX_FILE_SIZE = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024;
const uploadsDir = path.join(__dirname, '..', 'uploads');

// Ensure uploads directory exists
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Uploads dir ready:', uploadsDir);
} catch (err) {
  console.error('Failed to create uploads dir', uploadsDir, err);
}

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return cb(
      new Error(`File type not allowed. Allowed extensions: ${allowedExtensions.join(', ')}`),
      false
    );
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// Helper function for creating notifications
const createNotification = async (recipient, sender, note, io) => {
  try {
    const notification = new Notification({
      recipient: recipient._id,
      type: 'note_shared',
      sender: sender._id,
      reference: note._id,
      referenceModel: 'Note',
      content: `${note.title || 'A note'} has been shared with you`
    });
    
    await notification.save();
    console.log('Created notification:', notification._id);
    
    // Emit socket events if available
    if (io) {
      // For notification bell
      io.to(recipient._id.toString()).emit('new_notification', {
        type: 'note_shared',
        _id: notification._id,
        sender: { name: sender.name, _id: sender._id },
        content: `${note.title || 'A note'} has been shared with you`,
        createdAt: new Date()
      });
      
      // For dashboard update - emit the note-shared event your client is listening for
      io.to(recipient._id.toString()).emit('note-shared', {
        noteId: note._id,
        sharedBy: sender._id
      });
      
      console.log(`Emitted note-shared event to user ${recipient._id}`);
    }
    
    return notification;
  } catch (err) {
    console.error('Error creating notification (non-fatal):', err);
    return null;
  }
};

// ======================= ROUTES ======================= //

// Upload a note
router.post(
  '/upload',
  auth,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            message: `File too large. Max size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB`
          });
        }
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  uploadNote
);

// Get all notes (for current user)
router.get('/', auth, getNotes);

// Download a note (only owner or shared recipient can download)
router.get('/download/:filename', auth, async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);

  try {
    // Find note document by fileUrl containing filename
    const note = await Note.findOne({ fileUrl: { $regex: filename } });
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    // Auth check
    const userId = req.user.id;
    const isOwner = note.uploadedBy && note.uploadedBy.toString() === userId;
    const isShared = (note.sharedWith || []).some(sw =>
      sw && sw.recipient && String(sw.recipient) === String(userId)
    );

    if (!isOwner && !isShared) {
      return res.status(403).json({ message: 'Unauthorized to download this note' });
    }

    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('File download failed', err);
        return res.status(500).json({ message: 'File download failed', error: err.message || err });
      }
    });
  } catch (err) {
    console.error('Download error', err);
    return res.status(500).json({ message: err.message });
  }
});

// Delete note
router.delete('/delete/:id', auth, deleteNote);

// Share note
router.post('/share/:id', auth, async (req, res) => {
  try {
    const { email } = req.body;
    const noteId = req.params.id;
    
    // Validate inputs
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Find the note and recipient
    const note = await Note.findById(noteId);
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }
    
    const recipient = await User.findOne({ email });
    if (!recipient) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if already shared
    if (!note.sharedWith) {
      note.sharedWith = [];
    }
    
    const alreadyShared = note.sharedWith.some(share => {
      const recipientId = share.recipient ? share.recipient.toString() : share.toString();
      return recipientId === recipient._id.toString();
    });
    
    if (alreadyShared) {
      return res.status(400).json({ message: 'Note already shared with this user' });
    }
    
    // Add to sharedWith array
    note.sharedWith.push({ recipient: recipient._id });
    await note.save();
    
    // Create notification
    await createNotification(recipient, req.user, note, req.app.get('io'));
    
    return res.json({ 
      message: 'Note shared successfully', 
      user: {
        _id: recipient._id,
        email: recipient.email,
        name: recipient.name
      }
    });
  } catch (err) {
    console.error('Error sharing note:', err);
    return res.status(500).json({ 
      message: 'Error sharing note', 
      error: err.message 
    });
  }
});

// Remove a note from current user's shared list
router.post('/unshare/:id', auth, async (req, res) => {
  try {
    const noteId = req.params.id;
    const userId = req.user._id;

    const note = await Note.findById(noteId);
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    // Filter out the current user from sharedWith array
    note.sharedWith = note.sharedWith.filter(share => {
      const recipientId = share.recipient ? share.recipient.toString() : share.toString();
      return recipientId !== userId.toString();
    });

    await note.save();
    
    return res.json({ message: 'Note removed from your shared list' });
  } catch (err) {
    console.error('Error unsharing note:', err);
    return res.status(500).json({ message: 'Server error while unsharing note' });
  }
});

module.exports = router;
